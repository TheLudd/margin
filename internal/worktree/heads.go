package worktree

import (
	"log"
	"path/filepath"

	"github.com/fsnotify/fsnotify"
)

// heads watches the git directory of every checkout for its HEAD moving,
// as on a commit, checkout, reset or pull. Those don't touch the files, so
// the index never sees them.
type heads struct {
	watcher *fsnotify.Watcher
	repos   map[string]string // root-relative repo by watched directory
}

func newHeads() *heads {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("worktree: commits are not followed: %v", err)
		return &heads{repos: map[string]string{}}
	}
	return &heads{watcher: w, repos: map[string]string{}}
}

func (h *heads) events() <-chan fsnotify.Event {
	if h.watcher == nil {
		return nil
	}
	return h.watcher.Events
}

func (h *heads) errors() <-chan error {
	if h.watcher == nil {
		return nil
	}
	return h.watcher.Errors
}

func (h *heads) close() {
	if h.watcher != nil {
		h.watcher.Close()
	}
}

// watch follows the git directories of repos, by root-relative path, and
// stops following those of other repositories. A git directory is watched
// along with its logs, as logs/HEAD records every move of HEAD.
func (h *heads) watch(root string, repos []string) {
	if h.watcher == nil {
		return
	}
	wanted := map[string]string{}
	for _, r := range repos {
		if dir, ok := gitDir(filepath.Join(root, r)); ok {
			wanted[dir] = r
			wanted[filepath.Join(dir, "logs")] = r
		}
	}
	for dir := range h.repos {
		if _, ok := wanted[dir]; !ok {
			h.watcher.Remove(dir)
			delete(h.repos, dir)
		}
	}
	for dir, r := range wanted {
		if _, ok := h.repos[dir]; ok {
			continue
		}
		if err := h.watcher.Add(dir); err == nil { // logs is tried again until it exists
			h.repos[dir] = r
		}
	}
}

// moved returns the repository whose HEAD ev shows moving.
func (h *heads) moved(ev fsnotify.Event) (string, bool) {
	switch filepath.Base(ev.Name) {
	case "HEAD", "packed-refs", "logs": // logs appears with the first commit
		r, ok := h.repos[filepath.Dir(ev.Name)]
		return r, ok
	}
	return "", false
}
