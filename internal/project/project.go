// Package project groups files into projects (W-02): a git checkout's
// project is its main checkout plus the worktrees linked from it; a file
// outside git belongs to the first folder under its root. It also works out
// which copies of a file have changed, and when (W-03).
package project

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"margin/internal/gitx"
	"margin/internal/index"
)

// Checkout is one checkout of a project.
type Checkout struct {
	Dir   string
	Label string
	Main  bool
	Info  gitx.Info
}

// Project is a main checkout plus its worktrees, or a plain folder.
type Project struct {
	Key       string
	Root      string // root name
	Rel       string // folder relative to the root, "" for the root itself
	Git       bool
	Checkouts []*Checkout // main first, then by label
	MainHead  string
	MainDir   string // the main checkout, even outside the roots
}

// Multi reports whether the project has several checkouts under the roots,
// so its files can have copies.
func (p *Project) Multi() bool { return p.Git && len(p.Checkouts) > 1 }

// Display is the project's name as shown: the root name followed by the
// folder, the root name left out with a single root (F-03), but kept for
// the root itself.
func (p *Project) Display(singleRoot bool) string {
	if p.Rel == "" {
		return p.Root
	}
	if singleRoot {
		return p.Rel
	}
	return p.Root + "/" + p.Rel
}

// CopyState is whether a copy of a file has changed, and when: a committed
// change by its commit, an uncommitted one by the file's mtime.
type CopyState struct {
	Changed     bool
	Uncommitted bool
	CommittedAt time.Time
}

// Time is when the copy changed.
func (s CopyState) Time(mtime time.Time) time.Time {
	if !s.Changed {
		return time.Time{}
	}
	if s.Uncommitted || s.CommittedAt.IsZero() {
		return mtime
	}
	return s.CommittedAt
}

// Placement is where a file belongs.
type Placement struct {
	Project  *Project
	Checkout *Checkout // nil outside git
	Rel      string    // within the checkout or project folder
}

// GroupKey identifies the file's copies across worktrees; "" when alone.
func (pl Placement) GroupKey() string {
	if pl.Checkout == nil || !pl.Project.Multi() {
		return ""
	}
	return pl.Project.Key + "\x00" + pl.Rel
}

// Model holds the projects of a set of roots.
type Model struct {
	roots []index.Root

	mu        sync.RWMutex
	projects  map[string]*Project
	checkouts map[string]*Checkout
	dirCache  map[string]string // folder → checkout folder, "" when none
	states    map[string]map[string]CopyState
}

// Build places every file and describes every checkout found.
func Build(roots []index.Root, files []index.File) *Model {
	m := &Model{roots: roots, projects: map[string]*Project{}, checkouts: map[string]*Checkout{}, dirCache: map[string]string{}, states: map[string]map[string]CopyState{}}
	for _, f := range files {
		m.Place(f)
	}
	return m
}

// Roots returns the roots.
func (m *Model) Roots() []index.Root { return m.roots }

func (m *Model) rootOf(abs string) (index.Root, string, bool) {
	for _, r := range m.roots {
		if abs == r.Path {
			return r, "", true
		}
		if strings.HasPrefix(abs, r.Path+"/") {
			return r, abs[len(r.Path)+1:], true
		}
	}
	return index.Root{}, "", false
}

// Place finds a file's project, discovering its checkout if new.
func (m *Model) Place(f index.File) Placement {
	root, _, ok := m.rootOf(f.Abs)
	if !ok {
		return Placement{}
	}
	dir := filepath.Dir(f.Abs)
	checkoutDir := m.checkoutDir(root, dir)
	if checkoutDir == "" {
		p := m.plainProject(root, dir)
		base := root.Path
		if p.Rel != "" {
			base = filepath.Join(root.Path, p.Rel)
		}
		rel, _ := filepath.Rel(base, f.Abs)
		return Placement{Project: p, Rel: filepath.ToSlash(rel)}
	}
	c, p := m.checkout(root, checkoutDir)
	if c == nil {
		p := m.plainProject(root, dir)
		rel, _ := filepath.Rel(filepath.Join(root.Path, p.Rel), f.Abs)
		return Placement{Project: p, Rel: filepath.ToSlash(rel)}
	}
	rel, _ := filepath.Rel(c.Dir, f.Abs)
	return Placement{Project: p, Checkout: c, Rel: filepath.ToSlash(rel)}
}

// checkoutDir walks up from dir to the root looking for a .git entry.
func (m *Model) checkoutDir(root index.Root, dir string) string {
	m.mu.RLock()
	cached, ok := m.dirCache[dir]
	m.mu.RUnlock()
	if ok {
		return cached
	}
	var visited []string
	found := ""
	for d := dir; ; d = filepath.Dir(d) {
		m.mu.RLock()
		cached, ok := m.dirCache[d]
		m.mu.RUnlock()
		if ok {
			found = cached
			break
		}
		visited = append(visited, d)
		if gitx.IsCheckout(d) {
			found = d
			break
		}
		if d == root.Path || !strings.HasPrefix(d, root.Path+"/") {
			break
		}
	}
	m.mu.Lock()
	for _, d := range visited {
		m.dirCache[d] = found
	}
	m.mu.Unlock()
	return found
}

func (m *Model) plainProject(root index.Root, dir string) *Project {
	_, rel, _ := m.rootOf(dir)
	first := ""
	if rel != "" {
		first = strings.SplitN(rel, "/", 2)[0]
	}
	key := "dir:" + root.Name + "/" + first
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.projects[key]; ok {
		return p
	}
	p := &Project{Key: key, Root: root.Name, Rel: first}
	m.projects[key] = p
	return p
}

// checkout describes a checkout folder, adding it to its project.
func (m *Model) checkout(root index.Root, dir string) (*Checkout, *Project) {
	m.mu.RLock()
	c, ok := m.checkouts[dir]
	m.mu.RUnlock()
	if ok {
		if c == nil {
			return nil, nil
		}
		m.mu.RLock()
		defer m.mu.RUnlock()
		return c, m.projectOfCheckout(c)
	}
	info, err := gitx.Describe(dir)
	if err != nil || info.Dir != dir {
		m.mu.Lock()
		m.checkouts[dir] = nil
		m.mu.Unlock()
		return nil, nil
	}
	c = &Checkout{Dir: dir, Label: filepath.Base(dir), Main: info.Main(), Info: info}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.checkouts[dir]; ok && existing != nil {
		return existing, m.projectOfCheckout(existing)
	}
	m.checkouts[dir] = c
	p, ok := m.projects[info.CommonDir]
	if !ok {
		p = &Project{Key: info.CommonDir, Root: root.Name, Git: true}
		if list, err := gitx.Worktrees(dir); err == nil && len(list) > 0 {
			p.MainDir, p.MainHead = list[0].Path, list[0].Head
		}
		m.projects[info.CommonDir] = p
	}
	p.Checkouts = append(p.Checkouts, c)
	sort.Slice(p.Checkouts, func(i, j int) bool {
		if p.Checkouts[i].Main != p.Checkouts[j].Main {
			return p.Checkouts[i].Main
		}
		return p.Checkouts[i].Label < p.Checkouts[j].Label
	})
	m.name(p)
	return c, p
}

func (m *Model) projectOfCheckout(c *Checkout) *Project {
	return m.projects[c.Info.CommonDir]
}

// name sets a git project's folder: the parent shared by its checkouts when
// laid out as <name>/<worktree>, else the main checkout, else the first.
func (m *Model) name(p *Project) {
	root := m.rootByName(p.Root)
	if len(p.Checkouts) > 1 {
		parent := filepath.Dir(p.Checkouts[0].Dir)
		same := true
		for _, c := range p.Checkouts[1:] {
			if filepath.Dir(c.Dir) != parent {
				same = false
			}
		}
		if same && (parent == root.Path || strings.HasPrefix(parent, root.Path+"/")) {
			_, rel, _ := m.rootOf(parent)
			p.Rel = rel
			return
		}
	}
	for _, c := range p.Checkouts {
		if c.Main {
			_, rel, _ := m.rootOf(c.Dir)
			p.Rel = rel
			return
		}
	}
	_, rel, _ := m.rootOf(p.Checkouts[0].Dir)
	p.Rel = rel
}

func (m *Model) rootByName(name string) index.Root {
	for _, r := range m.roots {
		if r.Name == name {
			return r
		}
	}
	return index.Root{}
}

// Projects lists every project.
func (m *Model) Projects() []*Project {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Project, 0, len(m.projects))
	for _, p := range m.projects {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// Infos lists every checkout, for watching their HEADs.
func (m *Model) Infos() []gitx.Info {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var out []gitx.Info
	for _, c := range m.checkouts {
		if c != nil {
			out = append(out, c.Info)
		}
	}
	return out
}

// ProjectOfDir returns the project whose checkout holds a folder, if any.
func (m *Model) ProjectOfDir(dir string) *Project {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, c := range m.checkouts {
		if c != nil && (dir == c.Dir || strings.HasPrefix(dir, c.Dir+"/")) {
			return m.projects[c.Info.CommonDir]
		}
	}
	return nil
}

// Recompute asks git which files changed in each checkout of a project
// with several checkouts, and when.
func (m *Model) Recompute(p *Project) {
	if !p.Multi() {
		return
	}
	if list, err := gitx.Worktrees(p.Checkouts[0].Dir); err == nil && len(list) > 0 {
		m.mu.Lock()
		p.MainDir, p.MainHead = list[0].Path, list[0].Head
		m.mu.Unlock()
	}
	for _, c := range p.Checkouts {
		states := map[string]CopyState{}
		unc, err := gitx.Uncommitted(c.Dir)
		if err != nil {
			unc = map[string]bool{}
		}
		if c.Main || p.MainHead == "" {
			for rel := range unc {
				states[rel] = CopyState{Changed: true, Uncommitted: true}
			}
		} else {
			mb, err := gitx.MergeBase(c.Dir, "HEAD", p.MainHead)
			changed := map[string]bool{}
			times := map[string]int64{}
			if err == nil {
				changed, _ = gitx.ChangedSince(c.Dir, mb)
				times, _ = gitx.CommitTimes(c.Dir, mb, "HEAD")
			} else {
				changed = unc
			}
			for rel := range changed {
				s := CopyState{Changed: true, Uncommitted: unc[rel]}
				if t := times[rel]; t != 0 {
					s.CommittedAt = time.Unix(t, 0)
				}
				states[rel] = s
			}
		}
		m.mu.Lock()
		m.states[c.Dir] = states
		m.mu.Unlock()
	}
}

// State returns a copy's state within its checkout.
func (m *Model) State(pl Placement) CopyState {
	if pl.Checkout == nil {
		return CopyState{}
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.states[pl.Checkout.Dir][pl.Rel]
}
