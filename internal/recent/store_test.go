package recent

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// load returns a store whose clock advances a minute per view.
func load(t *testing.T, path string) *Store {
	t.Helper()
	s, err := Load(path, 90*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time {
		clock = clock.Add(time.Minute)
		return clock
	}
	return s
}

func TestViewed(t *testing.T) {
	s := load(t, filepath.Join(t.TempDir(), "recent.json"))
	s.Add("a.md")

	if _, ok := s.Viewed("a.md"); !ok {
		t.Fatal("a.md not viewed")
	}
	if _, ok := s.Viewed("b.md"); ok {
		t.Fatal("b.md viewed")
	}
}

func TestForgetsOldViews(t *testing.T) {
	s := load(t, filepath.Join(t.TempDir(), "recent.json"))
	s.Add("old.md")
	s.now = func() time.Time { return time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC) }

	s.Add("new.md")

	if _, ok := s.Viewed("old.md"); ok {
		t.Fatal("old view kept")
	}
}

func TestPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "recent.json")
	s := load(t, path)
	s.Add("a.md")
	s.Add("b.md")

	reloaded, err := Load(path, time.Hour)

	if err != nil {
		t.Fatal(err)
	}
	a, _ := reloaded.Viewed("a.md")
	b, _ := reloaded.Viewed("b.md")
	if !b.After(a) {
		t.Fatalf("a %v, b %v", a, b)
	}
}

func TestLoadsLegacyList(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recent.json")
	os.WriteFile(path, []byte(`["b.md","a.md"]`), 0o644)

	s, err := Load(path, time.Hour)

	if err != nil {
		t.Fatal(err)
	}
	a, _ := s.Viewed("a.md")
	b, okB := s.Viewed("b.md")
	if !okB || !b.After(a) {
		t.Fatalf("a %v, b %v", a, b)
	}
}
