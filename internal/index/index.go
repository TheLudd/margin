// Package index lists every .md file under every root (F-01), leaves out what
// the exclude patterns say (F-02), and watches folders for changes (F-05).
package index

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"margin/internal/ignore"
)

// Root is a served folder: its name, the first part of every path in it, and
// its resolved absolute path.
type Root struct {
	Name string
	Path string
}

// File is an indexed markdown file.
type File struct {
	Abs   string // resolved absolute path
	Root  string // root name
	Rel   string // slash-separated path within the root
	Hash  string // hex sha256 of the content
	Mtime time.Time
	Size  int64
}

// Path is the file's margin path, /<root>/<rel>.
func (f File) Path() string { return "/" + f.Root + "/" + f.Rel }

// Kind is what happened to a file.
type Kind int

const (
	Added Kind = iota
	Changed
	Removed
)

func (k Kind) String() string {
	switch k {
	case Added:
		return "added"
	case Changed:
		return "changed"
	}
	return "removed"
}

// Event is a change to an indexed file.
type Event struct {
	Kind Kind
	File File
}

// Debounce is how long after the last write a file is rehashed.
const Debounce = 100 * time.Millisecond

// Index holds the files and watches their folders.
type Index struct {
	roots   []Root
	exclude ignore.Exclude

	mu     sync.RWMutex
	files  map[string]File          // by absolute path
	stacks map[string]*ignore.Stack // by folder: the .gitignore files in force inside it
	dirs   map[string]Root          // watched folders and their root

	watcher *fsnotify.Watcher
	events  chan Event
	timers  map[string]*time.Timer
	tmu     sync.Mutex
	done    chan struct{}
	closed  sync.Once
}

// New walks the roots and starts watching them.
func New(roots []Root, exclude []string) (*Index, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	ix := &Index{
		roots:   roots,
		exclude: ignore.NewExclude(exclude),
		files:   map[string]File{},
		stacks:  map[string]*ignore.Stack{},
		dirs:    map[string]Root{},
		watcher: w,
		events:  make(chan Event, 1024),
		timers:  map[string]*time.Timer{},
		done:    make(chan struct{}),
	}
	for _, r := range roots {
		ix.walk(r, r.Path, nil)
	}
	go ix.loop()
	return ix, nil
}

// Roots returns the served roots.
func (ix *Index) Roots() []Root { return ix.roots }

// Events delivers added, changed and removed files.
func (ix *Index) Events() <-chan Event { return ix.events }

// Done is closed when the index is closed.
func (ix *Index) Done() <-chan struct{} { return ix.done }

// Files returns every indexed file, sorted by path.
func (ix *Index) Files() []File {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := make([]File, 0, len(ix.files))
	for _, f := range ix.files {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Abs < out[j].Abs })
	return out
}

// Get returns an indexed file by absolute path.
func (ix *Index) Get(abs string) (File, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	f, ok := ix.files[abs]
	return f, ok
}

// Close stops watching.
func (ix *Index) Close() {
	ix.closed.Do(func() {
		close(ix.done)
		ix.watcher.Close()
	})
}

// Rehash rereads a file right away (after margin's own write) and returns its
// record, updated. No event is sent; the caller tells whoever needs to know.
func (ix *Index) Rehash(abs string) (File, bool) {
	ev, ok := ix.refresh(abs)
	if ok {
		return ev.File, ev.Kind != Removed
	}
	return ix.Get(abs)
}

// Excluded reports whether a path within a root is left out by a pattern.
func (ix *Index) Excluded(root Root, rel string) bool {
	return ix.exclude.Matches(root.Name + "/" + rel)
}

func (ix *Index) rootOf(abs string) (Root, string, bool) {
	for _, r := range ix.roots {
		if abs == r.Path {
			return r, "", true
		}
		if strings.HasPrefix(abs, r.Path+string(filepath.Separator)) {
			return r, filepath.ToSlash(abs[len(r.Path)+1:]), true
		}
	}
	return Root{}, "", false
}

// walk indexes a folder and everything under it, returning the files found.
func (ix *Index) walk(root Root, dir string, parent *ignore.Stack) []File {
	stack := parent
	if f, err := os.Open(filepath.Join(dir, ".gitignore")); err == nil {
		_, base, _ := ix.rootOf(dir)
		stack = stack.Push(base, ignore.Parse(f))
		f.Close()
	}
	ix.mu.Lock()
	ix.stacks[dir] = stack
	ix.dirs[dir] = root
	ix.mu.Unlock()
	_ = ix.watcher.Add(dir)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var found []File
	for _, e := range entries {
		name := e.Name()
		abs := filepath.Join(dir, name)
		_, rel, _ := ix.rootOf(abs)
		if e.Type()&os.ModeSymlink != 0 {
			continue
		}
		if e.IsDir() {
			if ignore.Skipped(name) || stack.Ignored(rel, true) {
				continue
			}
			found = append(found, ix.walk(root, abs, stack)...)
			continue
		}
		if !e.Type().IsRegular() || !isMarkdown(name) {
			continue
		}
		if stack.Ignored(rel, false) || ix.exclude.Matches(root.Name+"/"+rel) {
			continue
		}
		if f, ok := ix.read(root, abs, rel); ok {
			ix.mu.Lock()
			ix.files[abs] = f
			ix.mu.Unlock()
			found = append(found, f)
		}
	}
	return found
}

func isMarkdown(name string) bool { return strings.HasSuffix(name, ".md") }

func (ix *Index) read(root Root, abs, rel string) (File, bool) {
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return File{}, false
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return File{}, false
	}
	return File{Abs: abs, Root: root.Name, Rel: rel, Hash: Hash(data), Mtime: info.ModTime(), Size: info.Size()}, true
}

// Hash is the hex sha256 of content, as used for etags.
func Hash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (ix *Index) loop() {
	for {
		select {
		case <-ix.done:
			return
		case ev, ok := <-ix.watcher.Events:
			if !ok {
				return
			}
			ix.handle(ev)
		case _, ok := <-ix.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

func (ix *Index) handle(ev fsnotify.Event) {
	name := ev.Name
	dir := filepath.Dir(name)
	base := filepath.Base(name)
	ix.mu.RLock()
	root, isDir := ix.dirs[dir]
	_, knownDir := ix.dirs[name]
	stack := ix.stacks[dir]
	ix.mu.RUnlock()
	if !isDir && !knownDir {
		return
	}
	if ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename) {
		if knownDir {
			ix.dropDir(name)
			return
		}
		if isMarkdown(base) {
			ix.schedule(name)
		}
		return
	}
	if ev.Has(fsnotify.Create) {
		info, err := os.Lstat(name)
		if err != nil {
			return
		}
		if info.IsDir() {
			_, rel, _ := ix.rootOf(name)
			if ignore.Skipped(base) || stack.Ignored(rel, true) {
				return
			}
			for _, f := range ix.walk(root, name, stack) {
				ix.events <- Event{Kind: Added, File: f}
			}
			return
		}
	}
	if isMarkdown(base) {
		ix.schedule(name)
	}
}

// dropDir forgets a folder and every file under it.
func (ix *Index) dropDir(dir string) {
	ix.mu.Lock()
	var gone []File
	prefix := dir + string(filepath.Separator)
	for abs, f := range ix.files {
		if strings.HasPrefix(abs, prefix) {
			gone = append(gone, f)
			delete(ix.files, abs)
		}
	}
	for d := range ix.dirs {
		if d == dir || strings.HasPrefix(d, prefix) {
			delete(ix.dirs, d)
			delete(ix.stacks, d)
		}
	}
	ix.mu.Unlock()
	sort.Slice(gone, func(i, j int) bool { return gone[i].Abs < gone[j].Abs })
	for _, f := range gone {
		ix.events <- Event{Kind: Removed, File: f}
	}
}

func (ix *Index) schedule(abs string) {
	ix.tmu.Lock()
	defer ix.tmu.Unlock()
	if t, ok := ix.timers[abs]; ok {
		t.Stop()
	}
	ix.timers[abs] = time.AfterFunc(Debounce, func() {
		ix.tmu.Lock()
		delete(ix.timers, abs)
		ix.tmu.Unlock()
		if ev, ok := ix.refresh(abs); ok {
			select {
			case ix.events <- ev:
			case <-ix.done:
			}
		}
	})
}

// refresh rereads a file and reports what changed, if anything.
func (ix *Index) refresh(abs string) (Event, bool) {
	root, rel, ok := ix.rootOf(abs)
	if !ok {
		return Event{}, false
	}
	ix.mu.RLock()
	old, known := ix.files[abs]
	stack := ix.stacks[filepath.Dir(abs)]
	ix.mu.RUnlock()
	info, err := os.Lstat(abs)
	if err != nil || !info.Mode().IsRegular() {
		if known {
			ix.mu.Lock()
			delete(ix.files, abs)
			ix.mu.Unlock()
			return Event{Kind: Removed, File: old}, true
		}
		return Event{}, false
	}
	if stack.Ignored(rel, false) || ix.exclude.Matches(root.Name+"/"+rel) {
		return Event{}, false
	}
	f, ok := ix.read(root, abs, rel)
	if !ok {
		return Event{}, false
	}
	ix.mu.Lock()
	ix.files[abs] = f
	ix.mu.Unlock()
	if !known {
		return Event{Kind: Added, File: f}, true
	}
	if old.Hash != f.Hash {
		return Event{Kind: Changed, File: f}, true
	}
	return Event{}, false
}
