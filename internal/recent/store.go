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
	"slices"
	"sync"
	"time"
)

type Store struct {
	path string
	keep time.Duration // views older than this are forgotten
	now  func() time.Time

	mu    sync.Mutex
	views map[string]time.Time
}

// Load reads the views from path; a missing file means no views.
func Load(path string, keep time.Duration) (*Store, error) {
	s := &Store{path: path, keep: keep, now: time.Now, views: map[string]time.Time{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &s.views); err != nil {
		var legacy []string // most recent first, without times
		if json.Unmarshal(data, &legacy) != nil {
			return nil, err
		}
		for i, p := range legacy {
			s.views[p] = s.now().Add(-time.Duration(i) * time.Second)
		}
	}
	return s, nil
}

// Add records a view of rel now and persists the views.
func (s *Store) Add(rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	s.views[rel] = now
	maps.DeleteFunc(s.views, func(_ string, at time.Time) bool { return now.Sub(at) > s.keep })
	return s.save()
}

// Viewed reports when rel was last viewed.
func (s *Store) Viewed(rel string) (time.Time, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	at, ok := s.views[rel]
	return at, ok
}

// Latest returns up to n of the most recently viewed paths accepted by exists,
// most recent first.
func (s *Store) Latest(n int, exists func(string) bool) []string {
	s.mu.Lock()
	paths := slices.Collect(maps.Keys(s.views))
	slices.SortFunc(paths, func(a, b string) int { return s.views[b].Compare(s.views[a]) })
	s.mu.Unlock()

	out := []string{}
	for _, p := range paths {
		if len(out) == n {
			break
		}
		if exists(p) {
			out = append(out, p)
		}
	}
	return out
}

func (s *Store) save() error {
	data, err := json.Marshal(s.views)
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
