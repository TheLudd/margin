package recent

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func all(string) bool { return true }

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

func TestLatest(t *testing.T) {
	s := load(t, filepath.Join(t.TempDir(), "recent.json"))
	for _, p := range []string{"a.md", "b.md", "c.md", "d.md", "b.md"} {
		if err := s.Add(p); err != nil {
			t.Fatal(err)
		}
	}

	if got := s.Latest(3, all); !slices.Equal(got, []string{"b.md", "d.md", "c.md"}) {
		t.Fatalf("got %v", got)
	}
	if got := s.Latest(5, func(p string) bool { return p != "d.md" }); !slices.Equal(got, []string{"b.md", "c.md", "a.md"}) {
		t.Fatalf("filtered got %v", got)
	}
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

	if got := s.Latest(5, all); !slices.Equal(got, []string{"new.md"}) {
		t.Fatalf("got %v", got)
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
	if got := reloaded.Latest(5, all); !slices.Equal(got, []string{"b.md", "a.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestLoadsLegacyList(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recent.json")
	os.WriteFile(path, []byte(`["b.md","a.md"]`), 0o644)

	s, err := Load(path, time.Hour)

	if err != nil {
		t.Fatal(err)
	}
	if got := s.Latest(5, all); !slices.Equal(got, []string{"b.md", "a.md"}) {
		t.Fatalf("got %v", got)
	}
}
