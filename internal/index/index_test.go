package index

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func paths(files []File) []string {
	var out []string
	for _, f := range files {
		out = append(out, f.Path)
	}
	return out
}

// watch scans root and returns the index plus a channel of its events.
func watch(t *testing.T, root string) (*Index, <-chan Event) {
	t.Helper()
	events := make(chan Event, 100)
	ix, err := New(root, nil, func(e Event) { events <- e })
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go ix.Run(ctx)
	t.Cleanup(func() { cancel(); ix.Close() })
	return ix, events
}

// expect waits for want, skipping other events.
func expect(t *testing.T, events <-chan Event, want Event) {
	t.Helper()
	timeout := time.After(2 * time.Second)
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

func TestScan(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "notes.md"), "")
	write(t, filepath.Join(root, "app", ".git", "HEAD"), "")
	write(t, filepath.Join(root, "app", ".gitignore"), "generated/\n*.draft.md\n")
	write(t, filepath.Join(root, "app", "README.md"), "")
	write(t, filepath.Join(root, "app", ".claude", "skills", "x", "SKILL.md"), "")
	write(t, filepath.Join(root, "app", "docs", "plan.draft.md"), "")
	write(t, filepath.Join(root, "app", "generated", "api.md"), "")
	write(t, filepath.Join(root, "app", "node_modules", "lib", "README.md"), "")
	write(t, filepath.Join(root, "app", "main.go"), "")
	write(t, filepath.Join(root, "loose", "deep", "todo.md"), "")

	ix, _ := watch(t, root)

	files := ix.Files()
	want := []string{"app/.claude/skills/x/SKILL.md", "app/README.md", "loose/deep/todo.md", "notes.md"}
	if got := paths(files); !slices.Equal(got, want) {
		t.Fatalf("got %v", got)
	}
	repos := []string{files[0].Repo, files[1].Repo, files[2].Repo, files[3].Repo}
	if !slices.Equal(repos, []string{"app", "app", "loose", ""}) {
		t.Fatalf("repos %v", repos)
	}
}

func TestGitignoreIsScopedToItsDirectory(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "a", ".gitignore"), "*.md\n")
	write(t, filepath.Join(root, "a", "x.md"), "")
	write(t, filepath.Join(root, "b", "x.md"), "")

	ix, _ := watch(t, root)

	if got := paths(ix.Files()); !slices.Equal(got, []string{"b/x.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestWatchFileChanges(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "repo", "plan.md"), "v1")
	ix, events := watch(t, root)

	write(t, filepath.Join(root, "repo", "plan.md"), "v2")
	expect(t, events, Event{Changed, "repo/plan.md"})

	tmp := filepath.Join(root, "repo", ".plan.md.tmp")
	write(t, tmp, "v3")
	if err := os.Rename(tmp, filepath.Join(root, "repo", "plan.md")); err != nil {
		t.Fatal(err)
	}
	expect(t, events, Event{Changed, "repo/plan.md"})

	write(t, filepath.Join(root, "repo", "new.md"), "")
	expect(t, events, Event{Added, "repo/new.md"})

	os.Remove(filepath.Join(root, "repo", "new.md"))
	expect(t, events, Event{Removed, "repo/new.md"})

	old := time.Now().AddDate(0, 0, -20)
	os.Chtimes(filepath.Join(root, "repo", "plan.md"), old, old)
	expect(t, events, Event{Changed, "repo/plan.md"})
	if got := ix.Files()[0].ModTime; !got.Equal(old) {
		t.Fatalf("modification time %v not followed", got)
	}

	if got := paths(ix.Files()); !slices.Equal(got, []string{"repo/plan.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestWatchDirectoryChanges(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "repo", "keep.md"), "")
	_, events := watch(t, root)

	staged := t.TempDir()
	write(t, filepath.Join(staged, "docs", "a.md"), "")
	if err := os.Rename(filepath.Join(staged, "docs"), filepath.Join(root, "repo", "docs")); err != nil {
		t.Fatal(err)
	}
	expect(t, events, Event{Added, "repo/docs/a.md"})

	write(t, filepath.Join(root, "repo", "docs", "b.md"), "")
	expect(t, events, Event{Added, "repo/docs/b.md"})

	if err := os.Rename(filepath.Join(root, "repo", "docs"), filepath.Join(root, "repo", "moved")); err != nil {
		t.Fatal(err)
	}
	expect(t, events, Event{Removed, "repo/docs/a.md"})
	expect(t, events, Event{Added, "repo/moved/a.md"})
}

func TestExclude(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "repo", "plan.md"), "")
	write(t, filepath.Join(root, "repo", "CHANGELOG.md"), "")
	events := make(chan Event, 10)
	ix, err := New(root, func(rel string) bool { return strings.HasSuffix(rel, "CHANGELOG.md") }, func(e Event) { events <- e })
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); ix.Close() })
	go ix.Run(ctx)

	if got := paths(ix.Files()); !slices.Equal(got, []string{"repo/plan.md"}) {
		t.Fatalf("got %v", got)
	}
	write(t, filepath.Join(root, "repo", "sub", "CHANGELOG.md"), "")
	write(t, filepath.Join(root, "repo", "new.md"), "")
	expect(t, events, Event{Added, "repo/new.md"})
	if ix.Has("repo/sub/CHANGELOG.md") {
		t.Fatal("excluded file added by the watcher")
	}
}
