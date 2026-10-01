// Package recent remembers the most recently viewed files across restarts.
package recent

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

type Store struct {
	path  string
	limit int
	mu    sync.Mutex
	paths []string // most recent first
}

// Load reads the list from path; a missing file is an empty list.
func Load(path string, limit int) (*Store, error) {
	s := &Store{path: path, limit: limit}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &s.paths); err != nil {
		return nil, err
	}
	return s, nil
}

// Add moves rel to the front of the list and persists it.
func (s *Store) Add(rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	paths := slices.DeleteFunc(slices.Clone(s.paths), func(p string) bool { return p == rel })
	paths = append([]string{rel}, paths...)
	s.paths = paths[:min(len(paths), s.limit*2)]
	return s.save()
}

// List returns up to limit paths, most recent first, keeping only those
// accepted by exists. Extra entries are stored so deleted files don't
// shrink the list.
func (s *Store) List(exists func(string) bool) []string {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := []string{}
	for _, p := range s.paths {
		if len(out) == s.limit {
			break
		}
		if exists(p) {
			out = append(out, p)
		}
	}
	return out
}

func (s *Store) save() error {
	data, err := json.Marshal(s.paths)
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
