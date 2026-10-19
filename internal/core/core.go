// Package core ties the index, the projects, the state and the config
// together and is what the HTTP layer talks to.
package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"margin/internal/config"
	"margin/internal/filetype"
	"margin/internal/gitx"
	"margin/internal/index"
	"margin/internal/lists"
	"margin/internal/project"
	"margin/internal/safepath"
	"margin/internal/state"
	"margin/internal/suggest"
	"margin/internal/textdiff"
)

// Errors the HTTP layer maps to statuses.
var (
	ErrNotFound = errors.New("not found")
	ErrOutside  = errors.New("outside root")
	ErrMismatch = errors.New("file changed")
	ErrNoCopy   = errors.New("no copy")
)

// RecomputeDelay is how long after a change a project's copies are
// recomputed (W-06).
var RecomputeDelay = time.Second

// SuggestBudget is how long folder suggestions may take (C-05).
var SuggestBudget = 1500 * time.Millisecond

// Options configure a core.
type Options struct {
	ConfigFile string
	StateDir   string
	Home       string
	Build      string
}

// Core is margin without the HTTP layer.
type Core struct {
	opts Options
	hub  *Hub

	mu     sync.RWMutex
	cfg    config.Config
	cfgErr string
	roots  []index.Root
	ix     *index.Index
	model  *project.Model
	st     *state.Store
	heads  *gitx.HeadWatcher

	stopCfg func()
	rmu     sync.Mutex
	timers  map[string]*time.Timer
	done    chan struct{}
	once    sync.Once
}

// New loads the state and the config and indexes the roots.
func New(opts Options) (*Core, error) {
	st, err := state.Open(opts.StateDir)
	if err != nil {
		return nil, fmt.Errorf("state: %w", err)
	}
	c := &Core{opts: opts, hub: NewHub(), st: st, cfg: config.Default(), timers: map[string]*time.Timer{}, done: make(chan struct{})}
	c.heads, err = gitx.WatchHeads(c.onHeadMove)
	if err != nil {
		return nil, err
	}
	cfg, loadErr := config.Load(opts.ConfigFile)
	if loadErr != nil {
		c.cfgErr = loadErr.Error()
	} else if err := c.apply(cfg, true); err != nil {
		c.cfgErr = err.Error()
	}
	c.stopCfg, err = config.Watch(opts.ConfigFile, c.reloadConfig)
	if err != nil {
		return nil, err
	}
	go c.daily()
	return c, nil
}

// Build is the build id the event stream starts with (P-09).
func (c *Core) Build() string { return c.opts.Build }

// Hub is where events are published.
func (c *Core) Hub() *Hub { return c.hub }

// Close stops watching.
func (c *Core) Close() {
	c.once.Do(func() {
		close(c.done)
		c.stopCfg()
		c.heads.Close()
		c.mu.Lock()
		if c.ix != nil {
			c.ix.Close()
		}
		c.mu.Unlock()
	})
}

func (c *Core) daily() {
	t := time.NewTicker(24 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			c.sweep()
		}
	}
}

func (c *Core) sweep() {
	c.mu.RLock()
	days := c.cfg.UnreadDays
	c.mu.RUnlock()
	c.st.Sweep(days, time.Now())
}

// reloadConfig is called when the file changed on disk (C-03).
func (c *Core) reloadConfig() {
	cfg, err := config.Load(c.opts.ConfigFile)
	c.mu.Lock()
	same := err == nil && cfg.Equal(c.cfg)
	c.mu.Unlock()
	if same {
		return
	}
	if err == nil {
		err = c.apply(cfg, false)
	}
	c.mu.Lock()
	if err != nil {
		c.cfgErr = err.Error()
	} else {
		c.cfgErr = ""
	}
	c.mu.Unlock()
	c.hub.Broadcast("config", nil)
}

// apply validates a config and takes it into use, re-indexing in place when
// the roots or the exclude patterns changed (C-07). On an invalid config
// nothing changes and the error is returned.
func (c *Core) apply(cfg config.Config, startup bool) error {
	if err := cfg.Validate(c.opts.Home); err != nil {
		return err
	}
	c.mu.RLock()
	sameRoots := !startup && cfg.RootsEqual(c.cfg) && c.ix != nil
	c.mu.RUnlock()
	if sameRoots {
		c.mu.Lock()
		c.cfg = cfg
		c.cfgErr = ""
		c.mu.Unlock()
		c.sweep()
		c.hub.Broadcast("lists", nil) // the labels may have changed (F-07)
		return nil
	}
	var roots []index.Root
	for _, r := range cfg.Roots {
		p, err := safepath.ResolveRoot(config.ExpandHome(r.Path, c.opts.Home))
		if err != nil {
			return fmt.Errorf("folder %s: %w", r.Path, err)
		}
		roots = append(roots, index.Root{Name: r.Name, Path: p})
	}
	ix, err := index.New(roots, cfg.Exclude)
	if err != nil {
		return err
	}
	model := project.Build(roots, ix.Files())
	c.mu.Lock()
	old := c.ix
	c.cfg, c.cfgErr, c.roots, c.ix, c.model = cfg, "", roots, ix, model
	c.mu.Unlock()
	if old != nil {
		old.Close()
	}
	c.heads.Reset()
	for _, info := range model.Infos() {
		c.heads.Add(info)
	}
	go c.consume(ix)
	c.recomputeAll(model)
	c.sweep()
	return nil
}

// recomputeAll works out the copies of every project with several checkouts.
func (c *Core) recomputeAll(model *project.Model) {
	for _, p := range model.Projects() {
		if p.Multi() {
			model.Recompute(p)
		}
	}
}

// consume turns index events into pushes and recomputations.
func (c *Core) consume(ix *index.Index) {
	for {
		select {
		case <-ix.Done():
			return
		case <-c.done:
			return
		case ev := <-ix.Events():
			c.mu.RLock()
			current := c.ix == ix
			model := c.model
			c.mu.RUnlock()
			if !current {
				continue
			}
			c.hub.Broadcast("file", map[string]any{"path": ev.File.Path(), "kind": ev.Kind.String(), "etag": etagOf(ev.File.Hash)})
			pl := model.Place(ev.File)
			if pl.Project != nil && pl.Project.Git {
				c.scheduleRecompute(model, pl.Project)
			}
			c.watchNewCheckouts(model)
		}
	}
}

func (c *Core) watchNewCheckouts(model *project.Model) {
	for _, info := range model.Infos() {
		c.heads.Add(info)
	}
}

// scheduleRecompute recomputes a project's copies about a second after the
// last change in it (W-06).
func (c *Core) scheduleRecompute(model *project.Model, p *project.Project) {
	c.rmu.Lock()
	defer c.rmu.Unlock()
	if t, ok := c.timers[p.Key]; ok {
		t.Stop()
	}
	c.timers[p.Key] = time.AfterFunc(RecomputeDelay, func() {
		c.rmu.Lock()
		delete(c.timers, p.Key)
		c.rmu.Unlock()
		model.Recompute(p)
		c.hub.Broadcast("lists", nil)
	})
}

// onHeadMove is called when HEAD moved in a checkout (N-05).
func (c *Core) onHeadMove(checkout string) {
	c.mu.RLock()
	model := c.model
	c.mu.RUnlock()
	if model == nil {
		return
	}
	repo, _ := c.pathOf(checkout)
	c.hub.Broadcast("head", map[string]any{"repo": repo})
	if p := model.ProjectOfDir(checkout); p != nil {
		c.scheduleRecompute(model, p)
	}
}

func etagOf(hash string) string { return `"` + hash[:32] + `"` }

// pathOf turns an absolute path into a margin path.
func (c *Core) pathOf(abs string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, r := range c.roots {
		if abs == r.Path {
			return "/" + r.Name, true
		}
		if strings.HasPrefix(abs, r.Path+"/") {
			return "/" + r.Name + "/" + abs[len(r.Path)+1:], true
		}
	}
	return "", false
}

// resolve turns a margin path into a resolved absolute path and its root.
func (c *Core) resolve(mpath string) (index.Root, string, string, error) {
	mpath = strings.TrimPrefix(mpath, "/")
	name, rel, _ := strings.Cut(mpath, "/")
	c.mu.RLock()
	roots := c.roots
	c.mu.RUnlock()
	for _, r := range roots {
		if r.Name == name {
			abs, err := safepath.Resolve(r.Path, rel)
			if errors.Is(err, fs.ErrNotExist) {
				return r, rel, "", ErrNotFound
			}
			if errors.Is(err, safepath.ErrOutside) {
				return r, rel, "", ErrOutside
			}
			if err != nil {
				return r, rel, "", err
			}
			return r, rel, abs, nil
		}
	}
	return index.Root{}, "", "", ErrNotFound
}

// Roots lists the served roots.
func (c *Core) Roots() []index.Root {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return append([]index.Root(nil), c.roots...)
}

// ListsView is the sidebar's data.
type ListsView struct {
	Roots      []RootView    `json:"roots"`
	ActiveDays int           `json:"activeDays"`
	Recent     []lists.Entry `json:"recent"`
	Older      []lists.Group `json:"older"`
}

// RootView is a root as the browser sees it.
type RootView struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Lists builds the sidebar's lists.
func (c *Core) Lists() ListsView {
	c.mu.RLock()
	ix, model, cfg, roots := c.ix, c.model, c.cfg, c.roots
	c.mu.RUnlock()
	view := ListsView{Roots: []RootView{}, ActiveDays: cfg.ActiveDays, Recent: []lists.Entry{}, Older: []lists.Group{}}
	for _, r := range roots {
		view.Roots = append(view.Roots, RootView{Name: r.Name, Path: r.Path})
	}
	if ix == nil {
		return view
	}
	files := ix.Files()
	in := lists.Input{Views: c.st.Views(), Dismissals: c.st.Dismissals(), Manual: c.st.ManualSet(), CopyHash: map[string]string{}, Now: time.Now(), ActiveDays: cfg.ActiveDays, SingleRoot: len(roots) == 1, Types: filetype.New(cfg.Types)}
	for _, f := range files {
		pl := model.Place(f)
		in.Files = append(in.Files, lists.FileInfo{File: f, Placement: pl, State: model.State(pl)})
		if h, ok := c.st.CopyHash(f.Abs); ok {
			in.CopyHash[f.Abs] = h
		}
	}
	l := lists.Build(in)
	view.Recent, view.Older = l.Recent, l.Older
	return view
}

// CopyView is one copy of a file across worktrees (W-04).
type CopyView struct {
	Path  string `json:"path"`
	Label string `json:"label"`
	State string `json:"state"`
	Time  int64  `json:"time,omitempty"`
}

// Doc is a file as the browser opens it.
type Doc struct {
	Path    string         `json:"path"`
	Name    string         `json:"name"`
	Dir     string         `json:"dir"`
	Type    *filetype.Type `json:"type,omitempty"`
	Content string         `json:"content"`
	Etag    string         `json:"etag"`
	Mtime   int64          `json:"mtime"`
	Git     string         `json:"git"`
	Manual  bool           `json:"manual"`
	HasCopy bool           `json:"hasCopy"`
	Unread  bool           `json:"unread"`
	Copies  []CopyView     `json:"copies"`
	Project string         `json:"project"`
}

func (c *Core) fileFor(root index.Root, rel, abs string) index.File {
	c.mu.RLock()
	ix := c.ix
	c.mu.RUnlock()
	if ix != nil {
		if f, ok := ix.Get(abs); ok {
			return f
		}
	}
	f := index.File{Abs: abs, Root: root.Name, Rel: rel}
	if info, err := os.Stat(abs); err == nil {
		f.Mtime = info.ModTime()
		f.Size = info.Size()
	}
	return f
}

// Meta is what the header shows about a file, without its content.
type Meta struct {
	Path    string     `json:"path"`
	Git     string     `json:"git"`
	Manual  bool       `json:"manual"`
	HasCopy bool       `json:"hasCopy"`
	Unread  bool       `json:"unread"`
	Copies  []CopyView `json:"copies"`
	Project string     `json:"project"`
	Etag    string     `json:"etag"`
}

// Meta describes a file without reading it into the browser.
func (c *Core) Meta(mpath string) (Meta, error) {
	doc, err := c.Read(mpath)
	if err != nil {
		return Meta{}, err
	}
	return Meta{Path: doc.Path, Git: doc.Git, Manual: doc.Manual, HasCopy: doc.HasCopy, Unread: doc.Unread, Copies: doc.Copies, Project: doc.Project, Etag: doc.Etag}, nil
}

// Read reads a file for the browser. With open, the file counts as opened:
// a view is recorded (S-03) and, the first time, the copy is made from the
// very bytes served (CH-02).
func (c *Core) Read(mpath string, open ...bool) (Doc, error) {
	root, rel, abs, err := c.resolve(mpath)
	if err != nil {
		return Doc{}, err
	}
	content, err := os.ReadFile(abs)
	if errors.Is(err, fs.ErrNotExist) {
		return Doc{}, ErrNotFound
	}
	if err != nil {
		return Doc{}, err
	}
	if len(open) > 0 && open[0] {
		if _, ok := c.st.CopyHash(abs); !ok {
			if err := c.st.PutCopy(abs, content); err != nil {
				return Doc{}, err
			}
		}
		if err := c.st.View(abs, time.Now()); err != nil {
			return Doc{}, err
		}
		defer c.hub.Broadcast("lists", nil)
	}
	hash := index.Hash(content)
	f := c.fileFor(root, rel, abs)
	f.Hash = hash
	c.mu.RLock()
	model, roots, types := c.model, c.roots, c.cfg.Types
	c.mu.RUnlock()
	label := filetype.New(types).Label(rel)
	doc := Doc{Path: "/" + root.Name + "/" + rel, Name: label.Name, Type: label.Type, Content: string(content), Etag: etagOf(hash), Mtime: f.Mtime.Unix(), Manual: c.st.Manual(abs), Copies: []CopyView{}}
	if len(roots) == 1 {
		doc.Dir = label.Dir
	} else if label.Dir == "" {
		doc.Dir = root.Name
	} else {
		doc.Dir = root.Name + "/" + label.Dir
	}
	if h, ok := c.st.CopyHash(abs); ok {
		doc.HasCopy = true
		doc.Unread = !doc.Manual && h != hash
	}
	pl := model.Place(f)
	if pl.Checkout != nil {
		doc.Git = string(gitx.FileState(pl.Checkout.Dir, pl.Rel))
	}
	if pl.Project != nil {
		doc.Project = pl.Project.Display(len(roots) == 1)
		if pl.Project.Multi() {
			doc.Copies = c.copies(model, pl)
		}
	}
	return doc, nil
}

func (c *Core) copies(model *project.Model, pl project.Placement) []CopyView {
	c.mu.RLock()
	ix := c.ix
	c.mu.RUnlock()
	var out []CopyView
	for _, ck := range pl.Project.Checkouts {
		abs := filepath.Join(ck.Dir, filepath.FromSlash(pl.Rel))
		f, ok := ix.Get(abs)
		if !ok {
			continue
		}
		cv := CopyView{Path: f.Path(), Label: ck.Label, State: "unchanged"}
		if ck.Main {
			cv.State = "main"
		}
		if s := model.State(project.Placement{Project: pl.Project, Checkout: ck, Rel: pl.Rel}); s.Changed {
			cv.State = "changed"
			cv.Time = s.Time(f.Mtime).Unix()
		}
		out = append(out, cv)
	}
	return out
}

// Write saves a file the browser edited (P-10, D-03). The copy advances with
// the save unless it holds unread changes (CH-03).
func (c *Core) Write(mpath string, content []byte, ifMatch string) (string, error) {
	_, _, abs, err := c.resolve(mpath)
	if err != nil {
		return "", err
	}
	current, err := os.ReadFile(abs)
	if errors.Is(err, fs.ErrNotExist) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	oldHash := index.Hash(current)
	if ifMatch != etagOf(oldHash) {
		return "", ErrMismatch
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", ErrNotFound
	}
	tmp := filepath.Join(filepath.Dir(abs), "."+filepath.Base(abs)+".margin-tmp")
	if err := os.WriteFile(tmp, content, info.Mode().Perm()); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, abs); err != nil {
		os.Remove(tmp)
		return "", err
	}
	newHash := index.Hash(content)
	if h, ok := c.st.CopyHash(abs); ok {
		if h == oldHash {
			// No unread changes: the copy advances with the save (CH-03).
			c.st.PutCopy(abs, content)
		} else if copyText, ok := c.st.Copy(abs); ok {
			// Unread changes stay unread; the reader's own edit joins the
			// copy so it never shows as unread (CH-14).
			c.st.PutCopy(abs, []byte(textdiff.Rebase(string(copyText), string(current), string(content))))
		}
	}
	c.mu.RLock()
	ix := c.ix
	c.mu.RUnlock()
	if ix != nil {
		ix.Rehash(abs)
	}
	c.hub.Broadcast("file", map[string]any{"path": mpath, "kind": "changed", "etag": etagOf(newHash)})
	return etagOf(newHash), nil
}

// MarkRead replaces the copy with the current content (CH-03) and times the
// view at the reading (S-01).
func (c *Core) MarkRead(mpath string) error {
	_, _, abs, err := c.resolve(mpath)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(abs)
	if err != nil {
		return ErrNotFound
	}
	if err := c.st.PutCopy(abs, content); err != nil {
		return err
	}
	if err := c.st.View(abs, time.Now()); err != nil {
		return err
	}
	c.hub.Broadcast("lists", nil)
	return nil
}

// SetManual marks a file manual or not, recording the current version as
// read either way (CH-13).
func (c *Core) SetManual(mpath string, on bool) error {
	_, _, abs, err := c.resolve(mpath)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(abs)
	if err != nil {
		return ErrNotFound
	}
	if err := c.st.SetManual(abs, on); err != nil {
		return err
	}
	if err := c.st.PutCopy(abs, content); err != nil {
		return err
	}
	c.hub.Broadcast("lists", nil)
	return nil
}

// Dismiss forgets a Recent entry's views and hides its activity up to now
// (S-05), for every copy of the file.
func (c *Core) Dismiss(mpath string) error {
	root, rel, abs, err := c.resolve(mpath)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if abs == "" {
		abs = filepath.Join(root.Path, filepath.FromSlash(rel))
	}
	now := time.Now()
	paths := []string{abs}
	c.mu.RLock()
	model, ix := c.model, c.ix
	c.mu.RUnlock()
	if ix != nil {
		if f, ok := ix.Get(abs); ok {
			pl := model.Place(f)
			if pl.GroupKey() != "" {
				for _, ck := range pl.Project.Checkouts {
					other := filepath.Join(ck.Dir, filepath.FromSlash(pl.Rel))
					if other != abs {
						paths = append(paths, other)
					}
				}
			}
		}
	}
	for _, p := range paths {
		if err := c.st.Dismiss(p, now); err != nil {
			return err
		}
	}
	c.hub.Broadcast("lists", nil)
	return nil
}

// Baseline returns the version a file is compared with (CH-01): the copy as
// last read, or the last commit.
func (c *Core) Baseline(mpath, kind string) ([]byte, error) {
	root, rel, abs, err := c.resolve(mpath)
	if err != nil {
		return nil, err
	}
	switch kind {
	case "head":
		c.mu.RLock()
		model := c.model
		c.mu.RUnlock()
		pl := model.Place(c.fileFor(root, rel, abs))
		if pl.Checkout == nil {
			return nil, ErrNoCopy
		}
		data, err := gitx.Show(pl.Checkout.Dir, "HEAD", pl.Rel)
		if err != nil {
			return nil, ErrNoCopy
		}
		return data, nil
	default:
		data, ok := c.st.Copy(abs)
		if !ok {
			return nil, ErrNoCopy
		}
		return data, nil
	}
}

// SettingsView is what the settings screen shows (C-09).
type SettingsView struct {
	Config config.Config `json:"config"`
	File   string        `json:"file"`
	State  string        `json:"state"`
	Error  string        `json:"error"`
}

// Settings returns the config as on disk and any error in it.
func (c *Core) Settings() SettingsView {
	c.mu.RLock()
	defer c.mu.RUnlock()
	cfg := c.cfg
	if cfg.Roots == nil {
		cfg.Roots = []config.Root{}
	}
	if cfg.Exclude == nil {
		cfg.Exclude = []string{}
	}
	if onDisk, err := config.Load(c.opts.ConfigFile); err == nil && c.cfgErr != "" {
		// Show what the file holds, so a broken edit can be fixed in place.
		if onDisk.Roots == nil {
			onDisk.Roots = []config.Root{}
		}
		if onDisk.Exclude == nil {
			onDisk.Exclude = []string{}
		}
		cfg = onDisk
	}
	return SettingsView{Config: cfg, File: c.opts.ConfigFile, State: c.opts.StateDir, Error: c.cfgErr}
}

// SaveSettings validates, writes the file and re-indexes in place (C-07).
func (c *Core) SaveSettings(cfg config.Config) (bool, error) {
	if cfg.Roots == nil {
		cfg.Roots = []config.Root{}
	}
	if cfg.Exclude == nil {
		cfg.Exclude = []string{}
	}
	if cfg.Types == nil {
		cfg.Types = []config.Type{}
	}
	for i := range cfg.Roots {
		cfg.Roots[i].Name = strings.TrimSpace(cfg.Roots[i].Name)
		cfg.Roots[i].Path = strings.TrimSpace(cfg.Roots[i].Path)
	}
	if err := cfg.Validate(c.opts.Home); err != nil {
		return false, err
	}
	c.mu.RLock()
	reindex := !cfg.RootsEqual(c.cfg) || c.ix == nil
	c.mu.RUnlock()
	if err := config.Save(c.opts.ConfigFile, cfg); err != nil {
		return false, err
	}
	if err := c.apply(cfg, false); err != nil {
		return false, err
	}
	c.hub.Broadcast("config", nil)
	return reindex, nil
}

// Suggest lists the folders in home holding markdown (C-05).
func (c *Core) Suggest() []suggest.Suggestion {
	c.mu.RLock()
	roots := c.roots
	c.mu.RUnlock()
	var served []string
	for _, r := range roots {
		served = append(served, r.Path)
	}
	out := suggest.Folders(c.opts.Home, served, SuggestBudget)
	if out == nil {
		out = []suggest.Suggestion{}
	}
	return out
}

// Complete completes a folder path as typed (C-06).
func (c *Core) Complete(typed string) []string {
	out := suggest.Complete(typed, c.opts.Home, 30)
	if out == nil {
		out = []string{}
	}
	return out
}
