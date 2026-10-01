// Package files reads and writes markdown files under a root directory,
// guarding against paths that escape it and against lost updates.
package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var (
	ErrNotFound    = errors.New("file not found")
	ErrOutsideRoot = errors.New("path is outside the root")
	ErrNotMarkdown = errors.New("not a markdown file")
	ErrConflict    = errors.New("file changed since it was read")
)

// Doc is a file's content and the etag identifying that exact content.
type Doc struct {
	Content []byte
	ETag    string
}

type Store struct {
	root string
	mu   sync.Mutex // serializes the etag check and the write
}

// New returns a store for root, which must exist.
func New(root string) (*Store, error) {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	return &Store{root: resolved}, nil
}

// ETag identifies content by hash, so two writes within the same mtime tick
// still get different etags.
func ETag(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:12])
}

func (s *Store) Read(rel string) (Doc, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return Doc{}, err
	}
	return read(abs)
}

// Write replaces the file's content if it still matches ifMatch, and returns
// the new etag. Only existing files can be written.
func (s *Store) Write(rel string, content []byte, ifMatch string) (string, error) {
	abs, err := s.resolve(rel)
	if err != nil {
		return "", err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := read(abs)
	if err != nil {
		return "", err
	}
	if current.ETag != ifMatch {
		return "", ErrConflict
	}
	if err := replace(abs, content); err != nil {
		return "", err
	}
	return ETag(content), nil
}

// resolve maps a root-relative path to the absolute path of an existing
// markdown file, following symlinks, and rejects anything outside the root.
func (s *Store) resolve(rel string) (string, error) {
	if !strings.HasSuffix(strings.ToLower(rel), ".md") {
		return "", ErrNotMarkdown
	}
	if filepath.IsAbs(rel) || !filepath.IsLocal(rel) {
		return "", ErrOutsideRoot
	}
	abs, err := filepath.EvalSymlinks(filepath.Join(s.root, rel))
	if errors.Is(err, fs.ErrNotExist) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(abs, s.root+string(filepath.Separator)) {
		return "", ErrOutsideRoot
	}
	if !strings.HasSuffix(strings.ToLower(abs), ".md") {
		return "", ErrNotMarkdown
	}
	return abs, nil
}

func read(abs string) (Doc, error) {
	content, err := os.ReadFile(abs)
	if errors.Is(err, fs.ErrNotExist) {
		return Doc{}, ErrNotFound
	}
	if err != nil {
		return Doc{}, err
	}
	return Doc{Content: content, ETag: ETag(content)}, nil
}

// replace writes content to a temp file next to abs and renames it over abs,
// so readers never see a half-written file. The file mode is kept.
func replace(abs string, content []byte) error {
	info, err := os.Stat(abs)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(abs), ".margin-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(info.Mode().Perm()); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), abs)
}
