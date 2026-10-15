// Package state keeps what margin remembers between runs (P-03): views and
// dismissals (S-03, S-05), the files marked manual (CH-13), and the copies of
// files as last read (CH-02, CH-04).
package state

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// ViewDays is how long views are kept.
const ViewDays = 365

type copyInfo struct {
	hash    string
	written time.Time
}

// Store is margin's state folder.
type Store struct {
	dir string

	mu        sync.Mutex
	views     map[string]time.Time
	dismissed map[string]time.Time
	manual    map[string]bool
	copies    map[string]copyInfo // by path key
}

type viewsFile struct {
	Views     map[string]time.Time `json:"views"`
	Dismissed map[string]time.Time `json:"dismissed"`
}

type manualFile struct {
	Manual []string `json:"manual"`
}

// Open loads the state in dir, creating it if needed.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "copies"), 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, views: map[string]time.Time{}, dismissed: map[string]time.Time{}, manual: map[string]bool{}, copies: map[string]copyInfo{}}
	var vf viewsFile
	if err := readJSON(filepath.Join(dir, "views.json"), &vf); err != nil {
		return nil, err
	}
	if vf.Views != nil {
		s.views = vf.Views
	}
	if vf.Dismissed != nil {
		s.dismissed = vf.Dismissed
	}
	var mf manualFile
	if err := readJSON(filepath.Join(dir, "manual.json"), &mf); err != nil {
		return nil, err
	}
	for _, p := range mf.Manual {
		s.manual[p] = true
	}
	entries, err := os.ReadDir(filepath.Join(dir, "copies"))
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		p := filepath.Join(dir, "copies", e.Name())
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		s.copies[e.Name()] = copyInfo{hash: hashOf(data), written: info.ModTime()}
	}
	return s, nil
}

// Dir is the state folder.
func (s *Store) Dir() string { return s.dir }

func readJSON(p string, v any) error {
	data, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func writeAtomic(p string, data []byte) error {
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func hashOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func key(abs string) string {
	sum := sha256.Sum256([]byte(abs))
	return hex.EncodeToString(sum[:16])
}

func (s *Store) saveViews() error {
	data, err := json.MarshalIndent(viewsFile{Views: s.views, Dismissed: s.dismissed}, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir, "views.json"), data)
}

func (s *Store) saveManual() error {
	list := make([]string, 0, len(s.manual))
	for p := range s.manual {
		list = append(list, p)
	}
	sort.Strings(list)
	data, err := json.MarshalIndent(manualFile{Manual: list}, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir, "manual.json"), data)
}

// View records that a file was opened at t.
func (s *Store) View(abs string, t time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.views[abs] = t
	return s.saveViews()
}

// Dismiss forgets a file's view and hides its activity up to t.
func (s *Store) Dismiss(abs string, t time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.views, abs)
	s.dismissed[abs] = t
	return s.saveViews()
}

// Views returns every view by absolute path.
func (s *Store) Views() map[string]time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneTimes(s.views)
}

// Dismissals returns every dismissal by absolute path.
func (s *Store) Dismissals() map[string]time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneTimes(s.dismissed)
}

func cloneTimes(m map[string]time.Time) map[string]time.Time {
	out := make(map[string]time.Time, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// Manual reports whether a file is marked manual.
func (s *Store) Manual(abs string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.manual[abs]
}

// ManualSet returns every file marked manual.
func (s *Store) ManualSet() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]bool, len(s.manual))
	for k := range s.manual {
		out[k] = true
	}
	return out
}

// SetManual marks a file manual or not.
func (s *Store) SetManual(abs string, on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if on {
		s.manual[abs] = true
	} else {
		delete(s.manual, abs)
	}
	return s.saveManual()
}

// Copy returns a file's copy as last read.
func (s *Store) Copy(abs string) ([]byte, bool) {
	s.mu.Lock()
	_, ok := s.copies[key(abs)]
	s.mu.Unlock()
	if !ok {
		return nil, false
	}
	data, err := os.ReadFile(filepath.Join(s.dir, "copies", key(abs)))
	if err != nil {
		return nil, false
	}
	return data, true
}

// CopyHash returns the content hash of a file's copy.
func (s *Store) CopyHash(abs string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.copies[key(abs)]
	return c.hash, ok
}

// PutCopy replaces a file's copy.
func (s *Store) PutCopy(abs string, content []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := key(abs)
	if err := writeAtomic(filepath.Join(s.dir, "copies", k), content); err != nil {
		return err
	}
	s.copies[k] = copyInfo{hash: hashOf(content), written: time.Now()}
	return nil
}

// Sweep removes copies not written for unreadDays and views and dismissals
// older than ViewDays, and reports how many copies went.
func (s *Store) Sweep(unreadDays int, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	removed := 0
	cutoff := now.Add(-time.Duration(unreadDays) * 24 * time.Hour)
	for k, c := range s.copies {
		if c.written.Before(cutoff) {
			os.Remove(filepath.Join(s.dir, "copies", k))
			delete(s.copies, k)
			removed++
		}
	}
	viewCutoff := now.Add(-ViewDays * 24 * time.Hour)
	changed := false
	for p, t := range s.views {
		if t.Before(viewCutoff) {
			delete(s.views, p)
			changed = true
		}
	}
	for p, t := range s.dismissed {
		if t.Before(viewCutoff) {
			delete(s.dismissed, p)
			changed = true
		}
	}
	if changed {
		s.saveViews()
	}
	return removed
}
