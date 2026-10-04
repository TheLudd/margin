package seen

import (
	"testing"

	"margin/internal/files"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func read(content string) func() ([]byte, error) {
	return func() ([]byte, error) { return []byte(content), nil }
}

func get(s *Store, path string) string {
	content, _, _ := s.Get(path)
	return string(content)
}

func TestGetUnknown(t *testing.T) {
	s := open(t)

	if _, ok, err := s.Get("code/a.md"); ok || err != nil {
		t.Fatalf("got %v, %v", ok, err)
	}
}

func TestSeed(t *testing.T) {
	s := open(t)

	s.Seed("code/a.md", read("v1"))

	if got := get(s, "code/a.md"); got != "v1" {
		t.Fatalf("got %q", got)
	}
}

func TestSeedKeepsWhatWasRead(t *testing.T) {
	s := open(t)
	s.Put("code/a.md", []byte("v1"))

	s.Seed("code/a.md", read("v2"))

	if got := get(s, "code/a.md"); got != "v1" {
		t.Fatalf("got %q", got)
	}
}

func TestPutReplaces(t *testing.T) {
	s := open(t)
	s.Put("code/a.md", []byte("v1"))

	s.Put("code/a.md", []byte("v2"))

	if got := get(s, "code/a.md"); got != "v2" {
		t.Fatalf("got %q", got)
	}
}

func TestAdvanceFromWhatWasRead(t *testing.T) {
	s := open(t)
	s.Put("code/a.md", []byte("v1"))

	s.Advance("code/a.md", files.ETag([]byte("v1")), []byte("v2"))

	if got := get(s, "code/a.md"); got != "v2" {
		t.Fatalf("got %q", got)
	}
}

func TestAdvanceKeepsUnreadChanges(t *testing.T) {
	s := open(t)
	s.Put("code/a.md", []byte("v0"))

	s.Advance("code/a.md", files.ETag([]byte("v1")), []byte("v2"))

	if got := get(s, "code/a.md"); got != "v0" {
		t.Fatalf("got %q", got)
	}
}

func TestKeepsPathsApart(t *testing.T) {
	s := open(t)
	s.Put("code/a.md", []byte("a"))
	s.Put("code/b.md", []byte("b"))

	if get(s, "code/a.md") != "a" || get(s, "code/b.md") != "b" {
		t.Fatal("paths share a copy")
	}
}
