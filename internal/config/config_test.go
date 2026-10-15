package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConfig(t *testing.T) {
	home := t.TempDir()
	os.MkdirAll(filepath.Join(home, "code"), 0o755)
	os.MkdirAll(filepath.Join(home, "code", "inner"), 0o755)
	os.MkdirAll(filepath.Join(home, "notes"), 0o755)

	t.Run("C-01: the keys are roots, exclude, activeDays and unreadDays, with defaults 14 and 30", func(t *testing.T) {
		c, err := Parse([]byte(`{"roots":[{"name":"code","path":"~/code"}],"exclude":["*.tmp.md"]}`))
		if err != nil || len(c.Roots) != 1 || c.Roots[0].Name != "code" || c.Exclude[0] != "*.tmp.md" || c.ActiveDays != 14 || c.UnreadDays != 30 {
			t.Fatalf("got %+v, %v", c, err)
		}
		c, _ = Parse([]byte(`{"activeDays": 7, "unreadDays": 60}`))
		if c.ActiveDays != 7 || c.UnreadDays != 60 || len(c.Roots) != 0 {
			t.Fatalf("got %+v", c)
		}
	})

	t.Run("P-02, C-04: a missing file is the default config without roots", func(t *testing.T) {
		c, err := Load(filepath.Join(home, "nothing.json"))
		if err != nil || len(c.Roots) != 0 || c.ActiveDays != 14 {
			t.Fatalf("got %+v, %v", c, err)
		}
	})

	t.Run("C-03: a broken file is an error with a message", func(t *testing.T) {
		if _, err := Parse([]byte(`{"roots": [`)); err == nil || !strings.Contains(err.Error(), "JSON") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("C-02: folders must exist", func(t *testing.T) {
		c := Config{Roots: []Root{{"code", "~/missing"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "does not exist") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("C-02: names must be unique, present, not paths and not margin's own routes", func(t *testing.T) {
		c := Config{Roots: []Root{{"code", "~/code"}, {"code", "~/notes"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "used twice") {
			t.Fatalf("got %v", err)
		}
		c = Config{Roots: []Root{{"", "~/code"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "no name") {
			t.Fatalf("got %v", err)
		}
		c = Config{Roots: []Root{{"api", "~/code"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "reserved") {
			t.Fatalf("got %v", err)
		}
		c = Config{Roots: []Root{{"a/b", "~/code"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "path") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("C-02: roots must not overlap", func(t *testing.T) {
		c := Config{Roots: []Root{{"code", "~/code"}, {"inner", "~/code/inner"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "overlap") {
			t.Fatalf("got %v", err)
		}
		c = Config{Roots: []Root{{"code", "~/code"}, {"notes", "~/notes"}}, ActiveDays: 14, UnreadDays: 30}
		if err := c.Validate(home); err != nil {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("C-01, C-02: activeDays and unreadDays are 1–365", func(t *testing.T) {
		for _, c := range []Config{{ActiveDays: 0, UnreadDays: 30}, {ActiveDays: 366, UnreadDays: 30}, {ActiveDays: 14, UnreadDays: 0}, {ActiveDays: 14, UnreadDays: 400}} {
			if err := c.Validate(home); err == nil || !strings.Contains(err.Error(), "1–365") {
				t.Errorf("%+v: got %v", c, err)
			}
		}
		if err := (Config{ActiveDays: 1, UnreadDays: 365}).Validate(home); err != nil {
			t.Error(err)
		}
	})

	t.Run("C-02: every problem is in the message", func(t *testing.T) {
		c := Config{Roots: []Root{{"", "~/missing"}}, ActiveDays: 0, UnreadDays: 30}
		err := c.Validate(home)
		if err == nil || !strings.Contains(err.Error(), "no name") || !strings.Contains(err.Error(), "does not exist") || !strings.Contains(err.Error(), "activeDays") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("C-07: a change of only the day counts needs no re-indexing", func(t *testing.T) {
		a := Config{Roots: []Root{{"code", "~/code"}}, Exclude: []string{"x"}, ActiveDays: 14, UnreadDays: 30}
		b := a
		b.ActiveDays = 7
		if !a.RootsEqual(b) || a.Equal(b) {
			t.Error("day change compared wrong")
		}
		b.Exclude = []string{"y"}
		if a.RootsEqual(b) {
			t.Error("exclude change compared wrong")
		}
	})

	t.Run("P-02, C-07: saving writes the file, creating its folder, and loading reads it back", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "deep", "margin", "config.json")
		c := Config{Roots: []Root{{"code", "~/code"}}, Exclude: []string{}, ActiveDays: 10, UnreadDays: 20}
		if err := Save(file, c); err != nil {
			t.Fatal(err)
		}
		got, err := Load(file)
		if err != nil || !got.Equal(c) {
			t.Fatalf("got %+v, %v", got, err)
		}
	})

	t.Run("C-03: hand edits to the file, in place or by rename, are noticed", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "config.json")
		Save(file, Default())
		changed := make(chan struct{}, 10)
		stop, err := Watch(file, func() { changed <- struct{}{} })
		if err != nil {
			t.Fatal(err)
		}
		defer stop()
		wait := func() {
			t.Helper()
			select {
			case <-changed:
			case <-time.After(3 * time.Second):
				t.Fatal("change not noticed")
			}
		}
		os.WriteFile(file, []byte(`{"activeDays": 3}`), 0o644)
		wait()
		os.WriteFile(file+".new", []byte(`{"activeDays": 4}`), 0o644)
		os.Rename(file+".new", file)
		wait()
		os.WriteFile(filepath.Join(filepath.Dir(file), "other.json"), []byte(`{}`), 0o644)
		select {
		case <-changed:
			t.Fatal("unrelated file reported")
		case <-time.After(300 * time.Millisecond):
		}
	})

	t.Run("C-06: a leading ~ expands to home", func(t *testing.T) {
		if ExpandHome("~/code", "/h") != "/h/code" || ExpandHome("~", "/h") != "/h" || ExpandHome("/abs", "/h") != "/abs" {
			t.Error("expand wrong")
		}
	})
}
