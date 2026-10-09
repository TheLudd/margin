package manual

import (
	"os"
	"path/filepath"
	"testing"
)

func load(t *testing.T, path string) *Store {
	t.Helper()
	s, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSet(t *testing.T) {
	s := load(t, filepath.Join(t.TempDir(), "manual.json"))
	s.Set("a.md", true)

	if !s.Is("a.md") {
		t.Fatal("a.md not manual")
	}
	if s.Is("b.md") {
		t.Fatal("b.md manual")
	}
}

func TestUnset(t *testing.T) {
	s := load(t, filepath.Join(t.TempDir(), "manual.json"))
	s.Set("a.md", true)
	s.Set("a.md", false)

	if s.Is("a.md") {
		t.Fatal("a.md still manual")
	}
}

func TestPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manual.json")
	s := load(t, path)
	s.Set("b.md", true)
	s.Set("a.md", true)

	if data, _ := os.ReadFile(path); string(data) != `["a.md","b.md"]` {
		t.Fatalf("stored %s", data)
	}
	if again := load(t, path); !again.Is("a.md") || !again.Is("b.md") {
		t.Fatal("not loaded")
	}
}

func TestPersistsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manual.json")
	s := load(t, path)
	s.Set("a.md", true)
	s.Set("a.md", false)

	if data, _ := os.ReadFile(path); string(data) != `[]` {
		t.Fatalf("stored %s", data)
	}
}

func TestLoadMissing(t *testing.T) {
	s := load(t, filepath.Join(t.TempDir(), "missing.json"))

	if s.Is("a.md") {
		t.Fatal("a.md manual")
	}
}
