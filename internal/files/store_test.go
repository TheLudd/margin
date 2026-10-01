package files

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func setup(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	write(t, filepath.Join(root, "repo", "plan.md"), "# plan\n")
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	return store, root
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRead(t *testing.T) {
	store, _ := setup(t)

	doc, err := store.Read("repo/plan.md")

	if err != nil {
		t.Fatal(err)
	}
	if string(doc.Content) != "# plan\n" || doc.ETag != ETag([]byte("# plan\n")) {
		t.Fatalf("got %q %q", doc.Content, doc.ETag)
	}
}

func TestReadRejects(t *testing.T) {
	store, root := setup(t)
	outside := t.TempDir()
	write(t, filepath.Join(outside, "secret.md"), "secret")
	if err := os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "repo", "link.md")); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "repo", "notes.txt"), "txt")

	cases := map[string]error{
		"../outside.md":   ErrOutsideRoot,
		"/etc/passwd.md":  ErrOutsideRoot,
		"repo/../../x.md": ErrOutsideRoot,
		"repo/link.md":    ErrOutsideRoot,
		"repo/notes.txt":  ErrNotMarkdown,
		"repo/missing.md": ErrNotFound,
	}
	for path, want := range cases {
		if _, err := store.Read(path); !errors.Is(err, want) {
			t.Errorf("%s: got %v, want %v", path, err, want)
		}
	}
}

func TestWrite(t *testing.T) {
	store, root := setup(t)
	path := filepath.Join(root, "repo", "plan.md")
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}

	etag, err := store.Write("repo/plan.md", []byte("# new\n"), ETag([]byte("# plan\n")))

	if err != nil {
		t.Fatal(err)
	}
	if etag != ETag([]byte("# new\n")) {
		t.Fatalf("etag %q", etag)
	}
	content, _ := os.ReadFile(path)
	if string(content) != "# new\n" {
		t.Fatalf("content %q", content)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", info.Mode())
	}
}

func TestWriteConflict(t *testing.T) {
	store, root := setup(t)
	write(t, filepath.Join(root, "repo", "plan.md"), "# changed by claude\n")

	_, err := store.Write("repo/plan.md", []byte("# mine\n"), ETag([]byte("# plan\n")))

	if !errors.Is(err, ErrConflict) {
		t.Fatalf("got %v", err)
	}
	content, _ := os.ReadFile(filepath.Join(root, "repo", "plan.md"))
	if string(content) != "# changed by claude\n" {
		t.Fatalf("content %q", content)
	}
}

func TestWriteThroughSymlinkKeepsLink(t *testing.T) {
	store, root := setup(t)
	link := filepath.Join(root, "repo", "alias.md")
	if err := os.Symlink(filepath.Join(root, "repo", "plan.md"), link); err != nil {
		t.Fatal(err)
	}

	if _, err := store.Write("repo/alias.md", []byte("# via link\n"), ETag([]byte("# plan\n"))); err != nil {
		t.Fatal(err)
	}

	info, _ := os.Lstat(link)
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("symlink was replaced by a regular file")
	}
	content, _ := os.ReadFile(filepath.Join(root, "repo", "plan.md"))
	if string(content) != "# via link\n" {
		t.Fatalf("content %q", content)
	}
}
