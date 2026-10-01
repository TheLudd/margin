// Package index keeps a live list of the markdown files under a root
// directory, skipping what .gitignore excludes, and reports changes.
package index

import (
	"cmp"
	"io/fs"
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
	root    string
	emit    func(Event)
	watcher *fsnotify.Watcher

	mu    sync.RWMutex
	files map[string]File

	// Only touched while scanning in New and by the Run goroutine after.
	ignore ignorer
	repos  map[string]bool
	dirs   map[string]bool
}

// New scans root and starts watching it. Call Run to process changes.
func New(root string, emit func(Event)) (*Index, error) {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	ix := &Index{
		root:    resolved,
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
	filepath.WalkDir(abs, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		rel := ix.rel(p)
		if d.IsDir() {
			if rel != "" && ix.skipDir(rel, d.Name()) {
				return fs.SkipDir
			}
			ix.enterDir(p, rel)
			return nil
		}
		if isMarkdown(d.Name()) && !ix.ignore.ignored(rel, false) && ix.put(p, rel) {
			added = append(added, rel)
		}
		return nil
	})
	return added
}

func (ix *Index) skipDir(rel, name string) bool {
	return skippedDirs[name] || ix.ignore.ignored(rel, true)
}

func (ix *Index) enterDir(abs, rel string) {
	ix.ignore.load(abs, rel)
	if _, err := os.Lstat(filepath.Join(abs, ".git")); err == nil {
		ix.repos[rel] = true
	}
	if err := ix.watcher.Add(abs); err != nil {
		log.Printf("watch %s: %v", abs, err)
		return
	}
	ix.dirs[abs] = true
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

func (ix *Index) rel(abs string) string {
	rel, err := filepath.Rel(ix.root, abs)
	if err != nil || rel == "." {
		return ""
	}
	return filepath.ToSlash(rel)
}

func isMarkdown(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), ".md")
}
