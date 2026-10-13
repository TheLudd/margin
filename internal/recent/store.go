// Package recent remembers when files were last viewed in margin, across
// restarts.
package recent

import (
	"encoding/json"
	"errors"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	path string
	keep time.Duration // entries older than this are forgotten
	now  func() time.Time

	mu    sync.Mutex
	state state
}

type state struct {
	Views map[string]time.Time `json:"views"`
}

// Load reads the store from path; a missing file means no views.
func Load(path string, keep time.Duration) (*Store, error) {
	s := &Store{path: path, keep: keep, now: time.Now, state: state{Views: map[string]time.Time{}}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := s.decode(data); err != nil {
		return nil, err
	}
	return s, nil
}

// decode reads the current format, or the older ones: a map of views, or a
// list of paths without times.
func (s *Store) decode(data []byte) error {
	var current state
	if err := json.Unmarshal(data, &current); err == nil && current.Views != nil {
		maps.Copy(s.state.Views, current.Views)
		return nil
	}
	var views map[string]time.Time
	if err := json.Unmarshal(data, &views); err == nil {
		maps.Copy(s.state.Views, views)
		return nil
	}
	var legacy []string // most recent first
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	for i, p := range legacy {
		s.state.Views[p] = s.now().Add(-time.Duration(i) * time.Second)
	}
	return nil
}

// Add records a view of rel now and persists the store.
func (s *Store) Add(rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.state.Views[rel] = s.now()
	return s.save()
}

// Forget removes the view of rel and persists the store.
func (s *Store) Forget(rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.state.Views, rel)
	return s.save()
}

// Viewed reports when rel was last viewed.
func (s *Store) Viewed(rel string) (time.Time, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	at, ok := s.state.Views[rel]
	return at, ok
}

// Rename moves entries to new paths. rename returns an entry's new path and
// whether to move it; when two entries end up on one path, the newer wins.
func (s *Store) Rename(rename func(string) (string, bool)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	changed := false
	times := s.state.Views
	for path, at := range maps.Clone(times) {
		to, ok := rename(path)
		if !ok || to == path {
			continue
		}
		delete(times, path)
		if existing, ok := times[to]; !ok || at.After(existing) {
			times[to] = at
		}
		changed = true
	}
	if !changed {
		return nil
	}
	return s.save()
}

// save prunes old views and writes the store atomically.
func (s *Store) save() error {
	now := s.now()
	maps.DeleteFunc(s.state.Views, func(_ string, at time.Time) bool { return now.Sub(at) > s.keep })

	data, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
