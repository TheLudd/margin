// Package index keeps a live list of the markdown files under a root
// directory, skipping what .gitignore excludes, and reports changes.
package index

import (
	"cmp"
	"log"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Kind string

const (
	Added   Kind = "added"
	Changed Kind = "changed"
	Removed Kind = "removed"
)

type Event struct {
	Kind Kind   `json:"kind"`
	Path string `json:"path"`
}

type File struct {
	Path    string    `json:"path"`
	Repo    string    `json:"repo"`
	ModTime time.Time `json:"mtime"`
}

type Index struct {
	emit    func(Event)
	watcher *fsnotify.Watcher

	mu    sync.RWMutex
	files map[string]File

	// Only touched while scanning in New and by the Run goroutine after.
	scope
	repos map[string]bool
	dirs  map[string]bool
}

// New scans root and starts watching it, leaving out the files exclude
// accepts (nil leaves out none). Call Run to process changes.
func New(root string, exclude func(rel string) bool, emit func(Event)) (*Index, error) {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	ix := &Index{
		scope:   scope{root: resolved, exclude: exclude},
		emit:    emit,
		watcher: watcher,
		files:   map[string]File{},
		repos:   map[string]bool{},
		dirs:    map[string]bool{},
	}
	ix.addTree(resolved)
	return ix, nil
}

func (ix *Index) Close() error {
	return ix.watcher.Close()
}

func (ix *Index) Files() []File {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	files := make([]File, 0, len(ix.files))
	for _, f := range ix.files {
		files = append(files, f)
	}
	slices.SortFunc(files, func(a, b File) int { return cmp.Compare(a.Path, b.Path) })
	return files
}

func (ix *Index) Has(rel string) bool {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	_, ok := ix.files[rel]
	return ok
}

// addTree scans abs, watching every directory it keeps, and returns the
// markdown files it added.
func (ix *Index) addTree(abs string) []string {
	var added []string
	ix.walk(abs, ix.enterDir, func(p, rel string) {
		if ix.put(p, rel) {
			added = append(added, rel)
		}
	})
	return added
}

func (ix *Index) enterDir(abs, rel string) error {
	if _, err := os.Lstat(filepath.Join(abs, ".git")); err == nil {
		ix.repos[rel] = true
	}
	if err := ix.watcher.Add(abs); err != nil {
		log.Printf("watch %s: %v", abs, err)
		return nil
	}
	ix.dirs[abs] = true
	return nil
}

// put records the file at abs and reports whether it is new to the index.
func (ix *Index) put(abs, rel string) bool {
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	ix.mu.Lock()
	defer ix.mu.Unlock()
	_, known := ix.files[rel]
	ix.files[rel] = File{Path: rel, Repo: ix.repoOf(rel), ModTime: info.ModTime()}
	return !known
}

// removeTree forgets rel and everything below it, and returns the markdown
// files it removed.
func (ix *Index) removeTree(rel string) []string {
	prefix := rel + "/"
	for dir := range ix.dirs {
		if r := ix.rel(dir); r == rel || strings.HasPrefix(r, prefix) {
			ix.watcher.Remove(dir)
			delete(ix.dirs, dir)
			delete(ix.repos, r)
		}
	}

	ix.mu.Lock()
	defer ix.mu.Unlock()
	var removed []string
	for p := range ix.files {
		if p == rel || strings.HasPrefix(p, prefix) {
			delete(ix.files, p)
			removed = append(removed, p)
		}
	}
	return removed
}

// repoOf returns the closest enclosing git repository, falling back to the
// top-level directory for files outside any repository.
func (ix *Index) repoOf(rel string) string {
	for dir := path.Dir(rel); dir != "."; dir = path.Dir(dir) {
		if ix.repos[dir] {
			return dir
		}
	}
	if top, _, found := strings.Cut(rel, "/"); found {
		return top
	}
	return ""
}
