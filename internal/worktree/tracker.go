// Package worktree groups git worktrees with their main checkout and tracks
// which markdown files each worktree changed, so the same file checked out
// in many worktrees can be shown once and opened where it was last changed.
package worktree

import (
	"context"
	"log"
	"maps"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"margin/internal/index"
)

const debounce = time.Second

type repo struct {
	main    string // the main checkout, root-relative
	git     bool   // a git checkout, not just a folder of files
	changed map[string]time.Time
}

type Tracker struct {
	root     string
	files    func() []index.File
	onChange func()
	onHead   func(repo string)

	mu    sync.RWMutex
	repos map[string]repo // by root-relative repo path
}

// New returns a tracker for the repositories of files under root. onChange
// is called whenever what it reports changes, and onHead with a repository
// whose HEAD moved, once the tracker is current.
func New(root string, files func() []index.File, onChange func(), onHead func(repo string)) *Tracker {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		resolved = root
	}
	return &Tracker{root: resolved, files: files, onChange: onChange, onHead: onHead, repos: map[string]repo{}}
}

// Project names the repository repo belongs to: for a worktree family laid
// out as <name>/<worktree>, that is <name>; otherwise the main checkout.
func (t *Tracker) Project(repoPath string) string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	r, ok := t.repos[repoPath]
	if !ok {
		return repoPath
	}
	return t.projectName(r.main)
}

// IsMain reports whether repo is the main checkout of its family.
func (t *Tracker) IsMain(repoPath string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	r, ok := t.repos[repoPath]
	return !ok || r.main == repoPath
}

// IsGit reports whether repo is a git checkout rather than a plain folder.
func (t *Tracker) IsGit(repoPath string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.repos[repoPath].git
}

// Changed reports when the worktree last changed the file at rel (relative
// to the repository) compared with the main checkout. For the main checkout
// that means uncommitted changes.
func (t *Tracker) Changed(repoPath, rel string) (time.Time, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	at, ok := t.repos[repoPath].changed[rel]
	return at, ok
}

// Refresh recomputes every repository.
func (t *Tracker) Refresh() {
	t.update(nil)
}

// Run keeps the tracker current from index events and moves of HEAD until
// ctx is done. subscribe is called again whenever the event stream ends.
func (t *Tracker) Run(ctx context.Context, subscribe func() (<-chan index.Event, func())) {
	h := newHeads()
	defer h.close()
	for ctx.Err() == nil {
		h.watch(t.root, t.gitRepos())
		events, unsubscribe := subscribe()
		t.follow(ctx, events, h)
		unsubscribe()
		t.Refresh() // events may have been missed
	}
}

func (t *Tracker) follow(ctx context.Context, events <-chan index.Event, h *heads) {
	pending := map[string]bool{} // paths changed
	moved := map[string]bool{}   // repos whose HEAD moved
	timer := time.NewTimer(debounce)
	timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			if ev.Path != "" {
				pending[ev.Path] = true
				timer.Reset(debounce)
			}
		case ev := <-h.events():
			if r, ok := h.moved(ev); ok {
				moved[r] = true
				pending[path.Join(r, ".git")] = true // touches r
				timer.Reset(debounce)
			}
		case err := <-h.errors():
			log.Printf("worktree: %v", err)
		case <-timer.C:
			t.update(slices.Collect(maps.Keys(pending)))
			clear(pending)
			h.watch(t.root, t.gitRepos())
			for r := range moved {
				if t.onHead != nil {
					t.onHead(r)
				}
			}
			clear(moved)
		}
	}
}

// gitRepos lists the repositories that are git checkouts.
func (t *Tracker) gitRepos() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	var repos []string
	for r, info := range t.repos {
		if info.git {
			repos = append(repos, r)
		}
	}
	return repos
}

// update recomputes the families touched by paths, or all of them when
// paths is nil or the set of repositories changed.
func (t *Tracker) update(paths []string) {
	mains := map[string]string{} // repo -> main checkout
	git := map[string]bool{}
	for _, f := range t.files() {
		if _, seen := mains[f.Repo]; seen {
			continue
		}
		mains[f.Repo] = f.Repo
		if main, ok := mainCheckout(filepath.Join(t.root, f.Repo)); ok {
			git[f.Repo] = true
			if rel, err := filepath.Rel(t.root, main); err == nil && filepath.IsLocal(rel) {
				mains[f.Repo] = filepath.ToSlash(rel)
			}
		}
	}

	t.mu.RLock()
	old := t.repos
	t.mu.RUnlock()

	dirty := map[string]bool{} // main checkouts to recompute
	sameRepos := len(old) == len(mains)
	for r, main := range mains {
		if o, ok := old[r]; !ok || o.main != main || o.git != git[r] {
			sameRepos = false
		}
	}
	for r, main := range mains {
		if paths == nil || !sameRepos || touches(paths, r) {
			dirty[main] = true
		}
	}

	next := map[string]repo{}
	for r, main := range mains {
		if dirty[main] {
			next[r] = repo{main: main, git: git[r], changed: t.changes(r, main)}
		} else {
			next[r] = old[r]
		}
	}

	t.mu.Lock()
	t.repos = next
	t.mu.Unlock()
	if !equal(old, next) && t.onChange != nil {
		t.onChange()
	}
}

func (t *Tracker) changes(repoPath, main string) map[string]time.Time {
	abs := filepath.Join(t.root, repoPath)
	if repoPath == main {
		return uncommitted(abs)
	}
	head, err := gitLine(filepath.Join(t.root, main), "rev-parse", "HEAD")
	if err != nil {
		return nil
	}
	base, err := gitLine(abs, "merge-base", "HEAD", head)
	if err != nil {
		return nil
	}
	return branchChanges(abs, base)
}

// projectName must be called with t.mu held.
func (t *Tracker) projectName(main string) string {
	parent := path.Dir(main)
	if parent == "." {
		return main
	}
	members := 0
	for r, info := range t.repos {
		if info.main == main {
			members++
			if path.Dir(r) != parent {
				return main
			}
		}
	}
	if members < 2 {
		return main
	}
	return parent
}

func touches(paths []string, repoPath string) bool {
	for _, p := range paths {
		if repoPath == "" || strings.HasPrefix(p, repoPath+"/") {
			return true
		}
	}
	return false
}

func equal(a, b map[string]repo) bool {
	return maps.EqualFunc(a, b, func(x, y repo) bool {
		return x.main == y.main && x.git == y.git && maps.EqualFunc(x.changed, y.changed, time.Time.Equal)
	})
}
