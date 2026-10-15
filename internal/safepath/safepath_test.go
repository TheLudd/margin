package safepath

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestResolve(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	for _, d := range []string{root, filepath.Join(root, "sub"), outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(filepath.Join(root, "sub", "a.md"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(outside, "secret.md"), []byte("s"), 0o644)
	os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "link.md"))
	os.Symlink(outside, filepath.Join(root, "dirlink"))
	os.Symlink(filepath.Join(root, "sub", "a.md"), filepath.Join(root, "inner.md"))
	root, _ = ResolveRoot(root)

	t.Run("P-07: a plain path inside the root resolves", func(t *testing.T) {
		got, err := Resolve(root, "sub/a.md")
		if err != nil || got != filepath.Join(root, "sub", "a.md") {
			t.Fatalf("got %q, %v", got, err)
		}
	})
	t.Run("P-07: dot-dot segments are rejected", func(t *testing.T) {
		if _, err := Resolve(root, "../outside/secret.md"); !errors.Is(err, ErrOutside) {
			t.Fatalf("got %v", err)
		}
		if _, err := Resolve(root, "sub/../../outside/secret.md"); !errors.Is(err, ErrOutside) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("P-07: a symlink to a file outside the root is rejected", func(t *testing.T) {
		if _, err := Resolve(root, "link.md"); !errors.Is(err, ErrOutside) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("P-07: a symlinked folder outside the root is rejected", func(t *testing.T) {
		if _, err := Resolve(root, "dirlink/secret.md"); !errors.Is(err, ErrOutside) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("P-07: a symlink inside the root resolves to its target", func(t *testing.T) {
		got, err := Resolve(root, "inner.md")
		if err != nil || got != filepath.Join(root, "sub", "a.md") {
			t.Fatalf("got %q, %v", got, err)
		}
	})
	t.Run("P-07, D-15: a missing file in a valid folder is reported missing, not outside", func(t *testing.T) {
		if _, err := Resolve(root, "sub/gone.md"); !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("got %v", err)
		}
		if _, err := Resolve(root, "dirlink/gone.md"); !errors.Is(err, ErrOutside) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("P-07: the root itself and an empty path are not files", func(t *testing.T) {
		if _, err := Resolve(root, ""); !errors.Is(err, ErrOutside) {
			t.Fatalf("got %v", err)
		}
	})
}
