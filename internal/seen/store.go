// Package seen keeps the version of every markdown file last read in margin,
// so the changes made since can be shown. margin only learns of a change
// after it is made, so the version a file has when margin first finds it
// counts as read.
//
// A copy is kept for a while after the file was last read, even when the
// file is gone, as it is after switching branches. After that, the file's
// current version counts as read again.
package seen

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"margin/internal/files"
)

type Store struct {
	dir string
	mu  sync.Mutex // serializes the check and the write in Seed and Advance
}

// Open returns a store keeping its copies in dir, which is created if needed.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

// Get returns the version of path last read, if one is recorded.
func (s *Store) Get(path string) ([]byte, bool, error) {
	content, err := os.ReadFile(s.file(path))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	return content, err == nil, err
}

// Put records content as the version of path last read.
func (s *Store) Put(path string, content []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.write(path, content)
}

// Seed records the version read returns, unless a version of path is
// recorded already. read is only called when needed.
func (s *Store) Seed(path string, read func() ([]byte, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(s.file(path)); !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	content, err := read()
	if err != nil {
		return err
	}
	return s.write(path, content)
}

// Advance records content if the version last read is the one with etag
// from. A save made in margin is read by definition, but changes not read
// yet stay unread.
func (s *Store) Advance(path, from string, content []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok, err := s.Get(path)
	if err != nil || !ok || files.ETag(current) != from {
		return err
	}
	return s.write(path, content)
}

// Prune forgets the versions read longer ago than keep. Every write
// replaces a copy, so its modification time is when it was read.
func (s *Store) Prune(keep time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-keep)
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || strings.HasPrefix(entry.Name(), ".") || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(s.dir, entry.Name())); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	return nil
}

// file names the copy of path by its hash, which is flat and safe whatever
// the path holds.
func (s *Store) file(path string) string {
	sum := sha256.Sum256([]byte(path))
	return filepath.Join(s.dir, hex.EncodeToString(sum[:16]))
}

func (s *Store) write(path string, content []byte) error {
	tmp, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.file(path))
}
