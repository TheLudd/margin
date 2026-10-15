package index

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, p, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func rels(files []File) []string {
	var out []string
	for _, f := range files {
		out = append(out, f.Root+"/"+f.Rel)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func next(t *testing.T, ix *Index) Event {
	t.Helper()
	select {
	case ev := <-ix.Events():
		return ev
	case <-time.After(3 * time.Second):
		t.Fatal("no event")
	}
	return Event{}
}

func none(t *testing.T, ix *Index) {
	t.Helper()
	select {
	case ev := <-ix.Events():
		t.Fatalf("unexpected event %v %s", ev.Kind, ev.File.Rel)
	case <-time.After(400 * time.Millisecond):
	}
}

func TestIndex(t *testing.T) {
	t.Run("F-01: every .md file under a root is indexed except under .git, node_modules and gitignored paths", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "a.md"), "a")
		write(t, filepath.Join(root, "docs", "b.md"), "b")
		write(t, filepath.Join(root, "docs", "notes.txt"), "no")
		write(t, filepath.Join(root, ".git", "x.md"), "git")
		write(t, filepath.Join(root, "node_modules", "pkg", "readme.md"), "nm")
		write(t, filepath.Join(root, ".gitignore"), "build/\n*.tmp.md\n")
		write(t, filepath.Join(root, "build", "out.md"), "built")
		write(t, filepath.Join(root, "c.tmp.md"), "tmp")
		write(t, filepath.Join(root, "sub", ".gitignore"), "secret.md\n")
		write(t, filepath.Join(root, "sub", "secret.md"), "s")
		write(t, filepath.Join(root, "sub", "open.md"), "o")
		ix, err := New([]Root{{Name: "r", Path: root}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer ix.Close()
		got := rels(ix.Files())
		want := []string{"r/a.md", "r/docs/b.md", "r/sub/open.md"}
		if !equal(got, want) {
			t.Fatalf("got %v want %v", got, want)
		}
	})

	t.Run("F-02: exclude patterns leave files out of the index", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "CHANGELOG.md"), "c")
		write(t, filepath.Join(root, "gen", "x.md"), "x")
		write(t, filepath.Join(root, "keep.md"), "k")
		ix, _ := New([]Root{{Name: "r", Path: root}}, []string{"changelog.md", "gen/*.md"})
		defer ix.Close()
		if got := rels(ix.Files()); !equal(got, []string{"r/keep.md"}) {
			t.Fatalf("got %v", got)
		}
		if !ix.Excluded(Root{Name: "r"}, "gen/y.md") || ix.Excluded(Root{Name: "r"}, "keep.md") {
			t.Error("Excluded wrong")
		}
	})

	t.Run("F-03: paths start with the root's name", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "margin", "plan.md"), "p")
		ix, _ := New([]Root{{Name: "code", Path: root}}, nil)
		defer ix.Close()
		if got := ix.Files()[0].Path(); got != "/code/margin/plan.md" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("F-05: writes in place and atomic renames are caught as changes, with the new hash", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "a.md"), "one")
		ix, _ := New([]Root{{Name: "r", Path: root}}, nil)
		defer ix.Close()
		before := ix.Files()[0].Hash

		write(t, filepath.Join(root, "a.md"), "two")
		ev := next(t, ix)
		if ev.Kind != Changed || ev.File.Rel != "a.md" || ev.File.Hash == before || ev.File.Hash != Hash([]byte("two")) {
			t.Fatalf("got %v %+v", ev.Kind, ev.File)
		}

		write(t, filepath.Join(root, ".a.md.tmp"), "three")
		os.Rename(filepath.Join(root, ".a.md.tmp"), filepath.Join(root, "a.md"))
		ev = next(t, ix)
		if ev.Kind != Changed || ev.File.Hash != Hash([]byte("three")) {
			t.Fatalf("got %v %+v", ev.Kind, ev.File)
		}
		if f, _ := ix.Get(filepath.Join(root, "a.md")); f.Hash != Hash([]byte("three")) {
			t.Error("index not updated")
		}
	})

	t.Run("F-05: added files, new folders and removals emit events", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "a.md"), "a")
		ix, _ := New([]Root{{Name: "r", Path: root}}, nil)
		defer ix.Close()

		write(t, filepath.Join(root, "b.md"), "b")
		if ev := next(t, ix); ev.Kind != Added || ev.File.Rel != "b.md" {
			t.Fatalf("got %v %s", ev.Kind, ev.File.Rel)
		}

		os.MkdirAll(filepath.Join(root, "new"), 0o755)
		time.Sleep(50 * time.Millisecond)
		write(t, filepath.Join(root, "new", "c.md"), "c")
		if ev := next(t, ix); ev.Kind != Added || ev.File.Rel != "new/c.md" {
			t.Fatalf("got %v %s", ev.Kind, ev.File.Rel)
		}

		os.Remove(filepath.Join(root, "b.md"))
		if ev := next(t, ix); ev.Kind != Removed || ev.File.Rel != "b.md" {
			t.Fatalf("got %v %s", ev.Kind, ev.File.Rel)
		}

		os.RemoveAll(filepath.Join(root, "new"))
		if ev := next(t, ix); ev.Kind != Removed || ev.File.Rel != "new/c.md" {
			t.Fatalf("got %v %s", ev.Kind, ev.File.Rel)
		}
		if got := rels(ix.Files()); !equal(got, []string{"r/a.md"}) {
			t.Fatalf("got %v", got)
		}
	})

	t.Run("F-05: a folder moved in whole is indexed, and one moved out is dropped", func(t *testing.T) {
		base := t.TempDir()
		root := filepath.Join(base, "root")
		os.MkdirAll(root, 0o755)
		write(t, filepath.Join(base, "staging", "x", "d.md"), "d")
		ix, _ := New([]Root{{Name: "r", Path: root}}, nil)
		defer ix.Close()
		os.Rename(filepath.Join(base, "staging"), filepath.Join(root, "moved"))
		if ev := next(t, ix); ev.Kind != Added || ev.File.Rel != "moved/x/d.md" {
			t.Fatalf("got %v %s", ev.Kind, ev.File.Rel)
		}
		os.Rename(filepath.Join(root, "moved"), filepath.Join(base, "away"))
		if ev := next(t, ix); ev.Kind != Removed || ev.File.Rel != "moved/x/d.md" {
			t.Fatalf("got %v %s", ev.Kind, ev.File.Rel)
		}
	})

	t.Run("F-05, S-02: a rewrite with the same content emits nothing", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "a.md"), "same")
		ix, _ := New([]Root{{Name: "r", Path: root}}, nil)
		defer ix.Close()
		write(t, filepath.Join(root, "a.md"), "same")
		none(t, ix)
	})

	t.Run("F-01, F-05: a file created under a gitignored folder or matching an exclude is not indexed", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, ".gitignore"), "build/\n")
		write(t, filepath.Join(root, "a.md"), "a")
		ix, _ := New([]Root{{Name: "r", Path: root}}, []string{"*.draft.md"})
		defer ix.Close()
		os.MkdirAll(filepath.Join(root, "build"), 0o755)
		time.Sleep(50 * time.Millisecond)
		write(t, filepath.Join(root, "build", "x.md"), "x")
		write(t, filepath.Join(root, "y.draft.md"), "y")
		none(t, ix)
	})

	t.Run("F-06: a changed .gitignore is picked up on restart, not live", func(t *testing.T) {
		root := t.TempDir()
		write(t, filepath.Join(root, "a.md"), "a")
		write(t, filepath.Join(root, "b.md"), "b")
		ix, _ := New([]Root{{Name: "r", Path: root}}, nil)
		write(t, filepath.Join(root, ".gitignore"), "b.md\n")
		none(t, ix)
		if got := rels(ix.Files()); !equal(got, []string{"r/a.md", "r/b.md"}) {
			t.Fatalf("live pickup: %v", got)
		}
		ix.Close()
		ix2, _ := New([]Root{{Name: "r", Path: root}}, nil)
		defer ix2.Close()
		if got := rels(ix2.Files()); !equal(got, []string{"r/a.md"}) {
			t.Fatalf("after restart: %v", got)
		}
	})

	t.Run("P-10: the hash is the sha256 of the content", func(t *testing.T) {
		if Hash([]byte("abc")) != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
			t.Error("hash wrong")
		}
	})
}
