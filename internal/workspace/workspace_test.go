package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"margin/internal/config"
	"margin/internal/index"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// dirs creates the code and notes folders, each with one markdown file.
func dirs(t *testing.T) (code, notes string) {
	t.Helper()
	base := t.TempDir()
	code, notes = filepath.Join(base, "code"), filepath.Join(base, "notes")
	write(t, filepath.Join(code, "repo", "plan.md"), "plan")
	write(t, filepath.Join(notes, "ideas.md"), "ideas")
	return code, notes
}

func expect(t *testing.T, events <-chan index.Event, want index.Event) {
	t.Helper()
	timeout := time.After(3 * time.Second)
	for {
		select {
		case got := <-events:
			if got == want {
				return
			}
		case <-timeout:
			t.Fatalf("no event %+v", want)
		}
	}
}

func TestWorkspace(t *testing.T) {
	code, notes := dirs(t)
	events := make(chan index.Event, 100)
	ws, err := Open(config.Config{Roots: []config.Root{{Name: "code", Path: code}, {Name: "notes", Path: notes}}}, func(e index.Event) { events <- e }, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()

	if !ws.Has("code/repo/plan.md") || !ws.Has("notes/ideas.md") || ws.Has("repo/plan.md") {
		t.Fatal("Has")
	}
	if root, rel, ok := ws.Resolve("notes/ideas.md"); !ok || root.Name != "notes" || rel != "ideas.md" {
		t.Fatalf("Resolve: %v %q %v", root, rel, ok)
	}
	if got, ok := ws.Locate("repo/plan.md"); !ok || got != "code/repo/plan.md" {
		t.Fatalf("Locate: %q %v", got, ok)
	}

	write(t, filepath.Join(notes, "new.md"), "")
	expect(t, events, index.Event{Kind: index.Added, Path: "notes/new.md"})
}

func TestManagerApplySavesAndSwitches(t *testing.T) {
	code, notes := dirs(t)
	file := filepath.Join(t.TempDir(), "margin", "config.json")
	reloads := 0
	m := NewManager(file, func(index.Event) {}, func(*Workspace) { reloads++ })
	defer m.Close()

	if len(m.Workspace().Roots()) != 0 {
		t.Fatal("expected no roots without a config")
	}
	c := config.Config{Roots: []config.Root{{Name: "code", Path: code}}}
	if err := m.Apply(c); err != nil {
		t.Fatal(err)
	}
	if !m.Workspace().Has("code/repo/plan.md") {
		t.Fatal("workspace not switched")
	}
	if saved, _ := config.Load(file); !config.Equal(saved, c) {
		t.Fatalf("saved %+v", saved)
	}

	before := reloads
	err := m.Apply(config.Config{Roots: []config.Root{{Name: "code", Path: code}, {Name: "code", Path: notes}}})
	if err == nil {
		t.Fatal("invalid config applied")
	}
	if !m.Workspace().Has("code/repo/plan.md") || reloads != before {
		t.Fatal("invalid config changed the workspace")
	}
}

func TestManagerReportsBrokenConfig(t *testing.T) {
	file := filepath.Join(t.TempDir(), "config.json")
	write(t, file, `{"roots": [{"name": "x", "path": "/does/not/exist"}]}`)

	m := NewManager(file, func(index.Event) {}, nil)
	defer m.Close()

	if _, err := m.Config(); err == nil {
		t.Fatal("broken config not reported")
	}
}

func TestManagerFollowsHandEdits(t *testing.T) {
	code, notes := dirs(t)
	file := filepath.Join(t.TempDir(), "config.json")
	config.Save(file, config.Config{Roots: []config.Root{{Name: "code", Path: code}}})
	m := NewManager(file, func(index.Event) {}, nil)
	defer m.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.Watch(ctx)
	time.Sleep(100 * time.Millisecond)

	write(t, file, `{"roots": [{"name": "notes", "path": "`+notes+`"}]}`)

	deadline := time.Now().Add(3 * time.Second)
	for !m.Workspace().Has("notes/ideas.md") {
		if time.Now().After(deadline) {
			t.Fatal("hand edit not applied")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if m.Workspace().Has("code/repo/plan.md") {
		t.Fatal("old root still served")
	}
}

func TestWorkspaceExcludes(t *testing.T) {
	code, _ := dirs(t)
	write(t, filepath.Join(code, "repo", "CHANGELOG.md"), "")

	ws, err := Open(config.Config{Roots: []config.Root{{Name: "code", Path: code}}, Exclude: []string{"CHANGELOG.md"}}, func(index.Event) {}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()

	if ws.Has("code/repo/CHANGELOG.md") || !ws.Has("code/repo/plan.md") {
		t.Fatal("exclude not applied")
	}
}
