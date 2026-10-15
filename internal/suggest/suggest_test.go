package suggest

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, p string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	os.WriteFile(p, []byte("x"), 0o644)
}

func TestSuggest(t *testing.T) {
	home := t.TempDir()
	write(t, filepath.Join(home, "code", "a", "one.md"))
	write(t, filepath.Join(home, "code", "a", "two.md"))
	write(t, filepath.Join(home, "code", "node_modules", "x.md"))
	write(t, filepath.Join(home, "code", ".git", "y.md"))
	write(t, filepath.Join(home, "code", ".hidden", "z.md"))
	write(t, filepath.Join(home, "notes", "n.md"))
	write(t, filepath.Join(home, "pictures", "p.png"))
	write(t, filepath.Join(home, ".config", "c.md"))
	write(t, filepath.Join(home, "served", "s.md"))
	write(t, filepath.Join(home, "parent", "child", "s.md"))

	t.Run("C-05: visible folders in home holding markdown are suggested with a count, served ones left out", func(t *testing.T) {
		got := Folders(home, []string{filepath.Join(home, "served"), filepath.Join(home, "parent", "child")}, 5*time.Second)
		if len(got) != 2 || got[0].Path != "~/code" || got[0].Count != 2 || got[0].Partial || got[1].Path != "~/notes" || got[1].Count != 1 {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("C-05: when counting runs out of time the count is a lower bound", func(t *testing.T) {
		got := Folders(home, nil, 0)
		for _, s := range got {
			if !s.Partial {
				t.Errorf("%+v not partial", s)
			}
		}
	})

	t.Run("C-06: paths complete as typed, keeping a leading ~", func(t *testing.T) {
		got := Complete("~/co", home, 20)
		if len(got) != 1 || got[0] != "~/code" {
			t.Fatalf("got %v", got)
		}
		got = Complete("~/code/", home, 20)
		if len(got) != 2 || got[0] != "~/code/a" || got[1] != "~/code/node_modules" {
			t.Fatalf("got %v", got)
		}
		got = Complete(home+"/no", home, 20)
		if len(got) != 1 || got[0] != home+"/notes" {
			t.Fatalf("got %v", got)
		}
		if Complete("rel", home, 20) != nil || Complete("", home, 20) != nil {
			t.Error("relative input completed")
		}
	})

	t.Run("C-06: hidden folders complete only once a dot is typed", func(t *testing.T) {
		for _, p := range Complete("~/", home, 20) {
			if filepath.Base(p)[0] == '.' {
				t.Errorf("hidden %s suggested", p)
			}
		}
		got := Complete("~/.c", home, 20)
		if len(got) != 1 || got[0] != "~/.config" {
			t.Fatalf("got %v", got)
		}
	})
}
