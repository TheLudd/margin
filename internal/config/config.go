// Package config reads and writes margin's configuration: the directories
// (roots) it serves.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

type Root struct {
	Name string `json:"name"` // the first segment of every path under it
	Path string `json:"path"` // may start with ~
}

type Config struct {
	Roots   []Root   `json:"roots"`
	Exclude []string `json:"exclude,omitempty"` // file patterns to leave out, see Excluded
}

// File returns where the config lives: $XDG_CONFIG_HOME/margin/config.json,
// falling back to ~/.config/margin/config.json.
func File() string {
	if dir := os.Getenv("XDG_CONFIG_HOME"); dir != "" {
		return filepath.Join(dir, "margin", "config.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "margin", "config.json")
}

// Load reads the config at path. A missing file is an empty config.
func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Config{}, nil
	}
	if err != nil {
		return Config{}, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

// Normalize trims the exclude patterns and drops blank ones.
func (c Config) Normalize() Config {
	exclude := []string{}
	for _, pattern := range c.Exclude {
		if pattern = strings.TrimSpace(pattern); pattern != "" {
			exclude = append(exclude, pattern)
		}
	}
	c.Exclude = exclude
	if len(exclude) == 0 {
		c.Exclude = nil
	}
	return c
}

// Save writes c to path atomically.
func Save(path string, c Config) error {
	if c.Roots == nil {
		c.Roots = []Root{}
	}
	data, err := json.MarshalIndent(c.Normalize(), "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

var validName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Validate checks that every root has a usable, unique name and an existing
// directory, that no root contains another, and that the exclude patterns
// are valid.
func (c Config) Validate() error {
	for _, pattern := range c.Exclude {
		if _, err := path.Match(strings.ToLower(pattern), ""); err != nil {
			return fmt.Errorf("pattern %q is not valid", pattern)
		}
	}
	names := map[string]bool{}
	var dirs []string
	for _, r := range c.Roots {
		if !validName.MatchString(r.Name) {
			return fmt.Errorf("name %q: use letters, digits, dots, dashes and underscores", r.Name)
		}
		if names[r.Name] {
			return fmt.Errorf("name %q is used twice", r.Name)
		}
		names[r.Name] = true

		dir, err := Resolve(r.Path)
		if err != nil {
			return fmt.Errorf("%s: %w", r.Path, err)
		}
		for _, other := range dirs {
			if within(dir, other) || within(other, dir) {
				return fmt.Errorf("%s overlaps with another folder", r.Path)
			}
		}
		dirs = append(dirs, dir)
	}
	return nil
}

// Resolve expands ~ and symlinks in path and checks that it is a directory.
func Resolve(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("no folder given")
	}
	resolved, err := filepath.EvalSymlinks(Expand(path))
	if errors.Is(err, fs.ErrNotExist) {
		return "", errors.New("no such folder")
	}
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
	return filepath.Abs(resolved)
}

// Expand replaces a leading ~ with the home directory.
func Expand(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	if rest, ok := strings.CutPrefix(path, "~/"); ok {
		return filepath.Join(home, rest)
	}
	return path
}

// Abbreviate replaces the home directory at the start of path with ~.
func Abbreviate(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == home {
		return "~"
	}
	if rest, ok := strings.CutPrefix(path, home+string(filepath.Separator)); ok {
		return "~/" + rest
	}
	return path
}

// DefaultName suggests a root name for a directory: its base name.
func DefaultName(path string) string {
	return filepath.Base(Expand(path))
}

// Excluded reports whether the file at rel (relative to its root, with
// slashes) is left out. A pattern without a slash matches the file name, as
// in CHANGELOG.md or *.draft.md; one with a slash matches the end of the
// path, as in generated/*.md. Case is ignored.
func (c Config) Excluded(rel string) bool {
	segments := strings.Split(strings.ToLower(rel), "/")
	for _, pattern := range c.Exclude {
		pattern = strings.ToLower(strings.Trim(strings.TrimSpace(pattern), "/"))
		if pattern == "" {
			continue
		}
		depth := strings.Count(pattern, "/") + 1
		if depth > len(segments) {
			continue
		}
		tail := strings.Join(segments[len(segments)-depth:], "/")
		if ok, _ := path.Match(pattern, tail); ok {
			return true
		}
	}
	return false
}

// Equal reports whether two configs are the same.
func Equal(a, b Config) bool {
	return slices.Equal(a.Roots, b.Roots) && slices.Equal(a.Exclude, b.Exclude)
}

func within(dir, parent string) bool {
	return dir == parent || strings.HasPrefix(dir, parent+string(filepath.Separator))
}
