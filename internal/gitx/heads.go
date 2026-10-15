package gitx

import (
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// HeadDebounce is how long after the last write to a HEAD file a move is
// reported.
const HeadDebounce = 200 * time.Millisecond

// HeadWatcher reports when HEAD moves in any watched checkout (N-05).
type HeadWatcher struct {
	w      *fsnotify.Watcher
	onMove func(checkout string)

	mu     sync.Mutex
	dirs   map[string][]string // watched folder → checkouts it concerns
	timers map[string]*time.Timer
	done   chan struct{}
	once   sync.Once
}

// WatchHeads starts a watcher; onMove is called with the checkout's folder.
func WatchHeads(onMove func(checkout string)) (*HeadWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	h := &HeadWatcher{w: w, onMove: onMove, dirs: map[string][]string{}, timers: map[string]*time.Timer{}, done: make(chan struct{})}
	go h.loop()
	return h, nil
}

// Add watches the folders holding a checkout's HEAD, logs/HEAD and
// packed-refs.
func (h *HeadWatcher) Add(info Info) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, p := range HeadPaths(info) {
		dir := filepath.Dir(p)
		if !contains(h.dirs[dir], info.Dir) {
			h.dirs[dir] = append(h.dirs[dir], info.Dir)
		}
		_ = h.w.Add(dir)
	}
}

// Reset forgets every checkout.
func (h *HeadWatcher) Reset() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for dir := range h.dirs {
		_ = h.w.Remove(dir)
	}
	h.dirs = map[string][]string{}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// Close stops watching.
func (h *HeadWatcher) Close() {
	h.once.Do(func() {
		close(h.done)
		h.w.Close()
	})
}

func (h *HeadWatcher) loop() {
	for {
		select {
		case <-h.done:
			return
		case ev, ok := <-h.w.Events:
			if !ok {
				return
			}
			base := filepath.Base(ev.Name)
			if base != "HEAD" && base != "packed-refs" && base != "HEAD.lock" && base != "packed-refs.lock" {
				continue
			}
			h.mu.Lock()
			checkouts := h.dirs[filepath.Dir(ev.Name)]
			for _, c := range checkouts {
				h.bump(c)
			}
			h.mu.Unlock()
		case _, ok := <-h.w.Errors:
			if !ok {
				return
			}
		}
	}
}

// bump schedules a report for a checkout; the caller holds the lock.
func (h *HeadWatcher) bump(checkout string) {
	if t, ok := h.timers[checkout]; ok {
		t.Stop()
	}
	h.timers[checkout] = time.AfterFunc(HeadDebounce, func() {
		h.mu.Lock()
		delete(h.timers, checkout)
		h.mu.Unlock()
		select {
		case <-h.done:
		default:
			h.onMove(checkout)
		}
	})
}
