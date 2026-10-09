// Package manual remembers which files are edited by hand, in an editor of
// the reader's own. The changes to such a file are the reader's, so they
// count as read, as edits made in margin do, until the file is handed back.
package manual

import (
	"encoding/json"
	"errors"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

type Store struct {
	path string

	mu    sync.Mutex
	paths map[string]bool
}

// Load reads the store from path; a missing file means no files are edited
// by hand.
func Load(path string) (*Store, error) {
	s := &Store{path: path, paths: map[string]bool{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var paths []string
	if err := json.Unmarshal(data, &paths); err != nil {
		return nil, err
	}
	for _, p := range paths {
		s.paths[p] = true
	}
	return s, nil
}

// Is reports whether the file at path is edited by hand.
func (s *Store) Is(path string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.paths[path]
}

// Set records whether the file at path is edited by hand and persists the
// store.
func (s *Store) Set(path string, on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if on {
		s.paths[path] = true
	} else {
		delete(s.paths, path)
	}
	return s.save()
}

// save writes the store atomically, as a sorted list of paths.
func (s *Store) save() error {
	paths := slices.Sorted(maps.Keys(s.paths))
	if paths == nil {
		paths = []string{}
	}
	data, err := json.Marshal(paths)
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
