// Package config reads, validates and writes margin's config (C-01, C-02)
// and watches it for hand edits (C-03).
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Root is a served folder as configured: a name and a path, which may start
// with ~.
type Root struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Type is a file type (F-07): files matching the pattern are shown with
// the mark and named by the part of their path the pattern does not fix.
// The pattern has the grammar of an exclude pattern. An empty mark is the
// name; an empty colour is taken from the palette in turn.
type Type struct {
	Name  string `json:"name"`
	Match string `json:"match"`
	Mark  string `json:"mark,omitempty"`
	Color string `json:"color,omitempty"`
}

// Colors are the palette tokens a type can be given, in the order they
// are handed out in turn.
var Colors = []string{"cyan", "magenta", "green", "amber", "blue", "red", "orange", "yellow", "violet", "grey"}

// IsColor reports whether a colour is a palette token.
func IsColor(c string) bool {
	for _, k := range Colors {
		if c == k {
			return true
		}
	}
	return false
}

// Config is the config file.
type Config struct {
	Roots      []Root   `json:"roots"`
	Exclude    []string `json:"exclude"`
	Types      []Type   `json:"types"`
	ActiveDays int      `json:"activeDays"`
	UnreadDays int      `json:"unreadDays"`
}

// Default is the config without a file.
func Default() Config {
	return Config{Roots: []Root{}, Exclude: []string{}, Types: []Type{}, ActiveDays: 14, UnreadDays: 30}
}

// Reserved are the names a root cannot have, being routes of margin's own.
var Reserved = []string{"api", "assets", "settings"}

// Parse reads a config, filling in defaults for what is missing.
func Parse(data []byte) (Config, error) {
	c := Default()
	if len(strings.TrimSpace(string(data))) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return Default(), fmt.Errorf("config is not valid JSON: %w", err)
	}
	if c.Roots == nil {
		c.Roots = []Root{}
	}
	if c.Exclude == nil {
		c.Exclude = []string{}
	}
	if c.Types == nil {
		c.Types = []Type{}
	}
	if c.ActiveDays == 0 {
		c.ActiveDays = 14
	}
	if c.UnreadDays == 0 {
		c.UnreadDays = 30
	}
	return c, nil
}

// Load reads the config file; a missing file is the default config.
func Load(file string) (Config, error) {
	data, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return Default(), nil
	}
	if err != nil {
		return Default(), err
	}
	return Parse(data)
}

// Save writes the config file, creating its folder.
func Save(file string, c Config) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

// ExpandHome replaces a leading ~ with the home folder.
func ExpandHome(p, home string) string {
	if p == "~" {
		return home
	}
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	return p
}

// Validate checks the config: folders must exist, names must be unique and
// not routes of margin's own, roots must not overlap, types must have
// unique names and a pattern, and the day counts must be 1–365. Every
// problem found is in the message.
func (c Config) Validate(home string) error {
	var problems []string
	names := map[string]bool{}
	type resolved struct {
		name, path string
	}
	var paths []resolved
	for i, r := range c.Roots {
		name := strings.TrimSpace(r.Name)
		switch {
		case name == "":
			problems = append(problems, fmt.Sprintf("root %d has no name", i+1))
		case strings.ContainsAny(name, "/\\") || name == "." || name == "..":
			problems = append(problems, fmt.Sprintf("name %q cannot be a path", name))
		case isReserved(name):
			problems = append(problems, fmt.Sprintf("name %q is reserved", name))
		case names[name]:
			problems = append(problems, fmt.Sprintf("name %q is used twice", name))
		}
		names[name] = true
		p := strings.TrimSpace(r.Path)
		if p == "" {
			problems = append(problems, fmt.Sprintf("root %q has no folder", name))
			continue
		}
		abs := ExpandHome(p, home)
		info, err := os.Stat(abs)
		if err != nil || !info.IsDir() {
			problems = append(problems, fmt.Sprintf("folder %s does not exist", p))
			continue
		}
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			abs = real
		}
		paths = append(paths, resolved{name, abs})
	}
	for i := range paths {
		for j := range paths {
			if i == j {
				continue
			}
			a, b := paths[i].path, paths[j].path
			if a == b || strings.HasPrefix(b, strings.TrimSuffix(a, "/")+"/") {
				problems = append(problems, fmt.Sprintf("roots %q and %q overlap", paths[i].name, paths[j].name))
			}
		}
	}
	typeNames := map[string]bool{}
	for i, t := range c.Types {
		name := strings.TrimSpace(t.Name)
		switch {
		case name == "":
			problems = append(problems, fmt.Sprintf("type %d has no name", i+1))
		case typeNames[strings.ToLower(name)]:
			problems = append(problems, fmt.Sprintf("type %q is used twice", name))
		}
		typeNames[strings.ToLower(name)] = true
		if strings.Trim(strings.TrimSpace(t.Match), "/") == "" {
			problems = append(problems, fmt.Sprintf("type %q has no pattern", name))
		}
		if t.Color != "" && !IsColor(t.Color) {
			problems = append(problems, fmt.Sprintf("type %q has an unknown colour %q", name, t.Color))
		}
	}
	if c.ActiveDays < 1 || c.ActiveDays > 365 {
		problems = append(problems, "activeDays must be 1–365")
	}
	if c.UnreadDays < 1 || c.UnreadDays > 365 {
		problems = append(problems, "unreadDays must be 1–365")
	}
	if len(problems) == 0 {
		return nil
	}
	sort.Strings(problems)
	return errors.New(strings.Join(unique(problems), "\n"))
}

func unique(list []string) []string {
	var out []string
	for i, s := range list {
		if i == 0 || s != list[i-1] {
			out = append(out, s)
		}
	}
	return out
}

func isReserved(name string) bool {
	for _, r := range Reserved {
		if strings.EqualFold(name, r) {
			return true
		}
	}
	return false
}

// Equal reports whether two configs are the same.
func (c Config) Equal(o Config) bool {
	a, _ := json.Marshal(c)
	b, _ := json.Marshal(o)
	return string(a) == string(b)
}

// RootsEqual reports whether two configs serve the same roots with the same
// exclude patterns, so no re-indexing is needed between them (C-07).
func (c Config) RootsEqual(o Config) bool {
	a, _ := json.Marshal([]any{c.Roots, c.Exclude})
	b, _ := json.Marshal([]any{o.Roots, o.Exclude})
	return string(a) == string(b)
}

// WatchDebounce is how long after the last write the file is reloaded.
const WatchDebounce = 100 * time.Millisecond

// Watch calls onChange after the config file is written, replaced or
// removed. The file's folder is watched, so atomic rename-writes are seen.
func Watch(file string, onChange func()) (func(), error) {
	dir := filepath.Dir(file)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return nil, err
	}
	done := make(chan struct{})
	go func() {
		var timer *time.Timer
		for {
			select {
			case <-done:
				return
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if filepath.Base(ev.Name) != filepath.Base(file) {
					continue
				}
				if timer != nil {
					timer.Stop()
				}
				timer = time.AfterFunc(WatchDebounce, func() {
					select {
					case <-done:
					default:
						onChange()
					}
				})
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
			}
		}
	}()
	return func() { close(done); w.Close() }, nil
}
