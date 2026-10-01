package recent

import (
	"path/filepath"
	"slices"
	"testing"
)

func all(string) bool { return true }

func TestAddMovesToFrontAndCaps(t *testing.T) {
	s, _ := Load(filepath.Join(t.TempDir(), "recent.json"), 3)

	for _, p := range []string{"a.md", "b.md", "c.md", "d.md", "b.md"} {
		if err := s.Add(p); err != nil {
			t.Fatal(err)
		}
	}

	if got := s.List(all); !slices.Equal(got, []string{"b.md", "d.md", "c.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestListSkipsMissingFiles(t *testing.T) {
	s, _ := Load(filepath.Join(t.TempDir(), "recent.json"), 2)
	for _, p := range []string{"a.md", "b.md", "c.md"} {
		s.Add(p)
	}

	got := s.List(func(p string) bool { return p != "c.md" })

	if !slices.Equal(got, []string{"b.md", "a.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "recent.json")
	s, _ := Load(path, 5)
	s.Add("a.md")
	s.Add("b.md")

	reloaded, err := Load(path, 5)

	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.List(all); !slices.Equal(got, []string{"b.md", "a.md"}) {
		t.Fatalf("got %v", got)
	}
}
