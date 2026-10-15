// Package safepath resolves a path inside a root (P-07): symlinks included,
// and anything that ends up outside the root is rejected.
package safepath

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ErrOutside is returned for a path that resolves outside its root.
var ErrOutside = errors.New("path outside root")

// Resolve returns the absolute, symlink-resolved path of rel inside root,
// which must itself be resolved. A missing file inside a valid folder gives
// fs.ErrNotExist; anything that leaves the root gives ErrOutside.
func Resolve(root, rel string) (string, error) {
	for _, part := range strings.Split(rel, "/") {
		if part == ".." {
			return "", ErrOutside
		}
	}
	rel = strings.TrimPrefix(filepath.Clean("/"+rel), "/")
	if rel == "" || rel == "." {
		return "", ErrOutside
	}
	abs := filepath.Join(root, rel)
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		// The file may be gone (D-15); its folder still has to be inside.
		dir, err := filepath.EvalSymlinks(filepath.Dir(abs))
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return "", fs.ErrNotExist
			}
			return "", err
		}
		if !inside(root, dir) {
			return "", ErrOutside
		}
		return "", fs.ErrNotExist
	}
	if !inside(root, resolved) {
		return "", ErrOutside
	}
	return resolved, nil
}

func inside(root, p string) bool {
	return p == root || strings.HasPrefix(p, strings.TrimSuffix(root, string(filepath.Separator))+string(filepath.Separator))
}

// Within reports whether an absolute, resolved path lies inside root.
func Within(root, p string) bool {
	return inside(root, p)
}

// ResolveRoot resolves a root folder itself.
func ResolveRoot(dir string) (string, error) {
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("not a folder")
	}
	return resolved, nil
}
