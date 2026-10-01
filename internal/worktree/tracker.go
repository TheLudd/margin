// Package worktree groups git worktrees with their main checkout and tracks
// which markdown files each worktree changed, so the same file checked out
// in many worktrees can be shown once and opened where it was last changed.
package worktree

import (
	"context"
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
	changed map[string]time.Time
}

type Tracker struct {
	root     string
	files    func() []index.File
	onChange func()

	mu    sync.RWMutex
	repos map[string]repo // by root-relative repo path
}

// New returns a tracker for the repositories of files under root. onChange
// is called whenever what it reports changes.
func New(root string, files func() []index.File, onChange func()) *Tracker {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		resolved = root
	}
	return &Tracker{root: resolved, files: files, onChange: onChange, repos: map[string]repo{}}
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

// Run keeps the tracker current from index events until ctx is done.
// subscribe is called again whenever the event stream ends.
func (t *Tracker) Run(ctx context.Context, subscribe func() (<-chan index.Event, func())) {
	for ctx.Err() == nil {
		events, unsubscribe := subscribe()
		t.follow(ctx, events)
		unsubscribe()
		t.Refresh() // events may have been missed
	}
}

func (t *Tracker) follow(ctx context.Context, events <-chan index.Event) {
	pending := map[string]bool{}
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
		case <-timer.C:
			t.update(slices.Collect(maps.Keys(pending)))
			clear(pending)
		}
	}
}

// update recomputes the families touched by paths, or all of them when
// paths is nil or the set of repositories changed.
func (t *Tracker) update(paths []string) {
	mains := map[string]string{} // repo -> main checkout
	for _, f := range t.files() {
		if _, seen := mains[f.Repo]; seen {
			continue
		}
		if main, ok := mainCheckout(filepath.Join(t.root, f.Repo)); ok {
			if rel, err := filepath.Rel(t.root, main); err == nil && filepath.IsLocal(rel) {
				mains[f.Repo] = filepath.ToSlash(rel)
				continue
			}
		}
		mains[f.Repo] = f.Repo
	}

	t.mu.RLock()
	old := t.repos
	t.mu.RUnlock()

	dirty := map[string]bool{} // main checkouts to recompute
	sameRepos := len(old) == len(mains)
	for r, main := range mains {
		if o, ok := old[r]; !ok || o.main != main {
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
			next[r] = repo{main: main, changed: t.changes(r, main)}
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
		return x.main == y.main && maps.EqualFunc(x.changed, y.changed, time.Time.Equal)
	})
}
