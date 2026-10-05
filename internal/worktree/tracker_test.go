package worktree

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"margin/internal/events"
	"margin/internal/index"
)

var committed = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

func run(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		"GIT_COMMITTER_DATE="+committed.Format(time.RFC3339), "GIT_AUTHOR_DATE="+committed.Format(time.RFC3339))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %v\n%s", args, err, out)
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// setup lays out ~/code with a project of three worktrees and a standalone
// repository:
//
//	proj/master   main checkout; CLAUDE.md changed after the branches forked
//	proj/feature  committed a change to docs/plan.md, uncommitted to other.md
//	proj/idle     changed nothing
//	solo          its own repository
//	notes         a plain folder, not in git
func setup(t *testing.T) (root string, tracker *Tracker, ix *index.Index) {
	t.Helper()
	root = t.TempDir()
	main := filepath.Join(root, "proj", "master")
	for _, f := range []string{"CLAUDE.md", "docs/plan.md", "other.md"} {
		write(t, filepath.Join(main, f), "v1 "+f)
	}
	run(t, main, "git", "init", "-q", "-b", "master")
	run(t, main, "git", "add", ".")
	run(t, main, "git", "commit", "-q", "-m", "init")
	run(t, main, "git", "worktree", "add", "-q", "../feature", "-b", "feature")
	run(t, main, "git", "worktree", "add", "-q", "../idle", "-b", "idle")

	feature := filepath.Join(root, "proj", "feature")
	write(t, filepath.Join(feature, "docs", "plan.md"), "v2")
	run(t, feature, "git", "commit", "-q", "-am", "plan")
	write(t, filepath.Join(feature, "other.md"), "draft")

	write(t, filepath.Join(main, "CLAUDE.md"), "v2")
	run(t, main, "git", "commit", "-q", "-am", "master moves on")

	solo := filepath.Join(root, "solo")
	write(t, filepath.Join(solo, "README.md"), "solo")
	run(t, solo, "git", "init", "-q")

	write(t, filepath.Join(root, "notes", "todo.md"), "todo")

	ix, err := index.New(root, nil, func(index.Event) {})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ix.Close() })
	tracker = New(root, ix.Files, nil, nil)
	tracker.Refresh()
	return root, tracker, ix
}

func TestIsGit(t *testing.T) {
	_, tracker, _ := setup(t)
	for repo, want := range map[string]bool{"proj/master": true, "proj/feature": true, "solo": true, "notes": false} {
		if got := tracker.IsGit(repo); got != want {
			t.Errorf("%s: got %v", repo, got)
		}
	}
}

func TestProject(t *testing.T) {
	_, tracker, _ := setup(t)

	cases := map[string]string{"proj/master": "proj", "proj/feature": "proj", "proj/idle": "proj", "solo": "solo"}
	for repo, want := range cases {
		if got := tracker.Project(repo); got != want {
			t.Errorf("Project(%s) = %s, want %s", repo, got, want)
		}
	}
	if !tracker.IsMain("proj/master") || tracker.IsMain("proj/feature") {
		t.Error("IsMain")
	}
}

func TestChanged(t *testing.T) {
	_, tracker, _ := setup(t)

	cases := []struct {
		repo, file string
		changed    bool
	}{
		{"proj/feature", "docs/plan.md", true},
		{"proj/feature", "other.md", true},
		{"proj/feature", "CLAUDE.md", false}, // only master changed it
		{"proj/idle", "docs/plan.md", false},
		{"proj/master", "CLAUDE.md", false}, // committed on master itself
		{"solo", "README.md", true},         // untracked
	}
	for _, c := range cases {
		if _, got := tracker.Changed(c.repo, c.file); got != c.changed {
			t.Errorf("Changed(%s, %s) = %v, want %v", c.repo, c.file, got, c.changed)
		}
	}
	if at, _ := tracker.Changed("proj/feature", "docs/plan.md"); !at.Equal(committed) {
		t.Errorf("committed change dated %v, want the commit time", at)
	}
	if at, _ := tracker.Changed("proj/feature", "other.md"); time.Since(at) > time.Minute {
		t.Errorf("uncommitted change dated %v, want its modification time", at)
	}
}

func TestRunFollowsEdits(t *testing.T) {
	root, tracker, _ := setup(t)
	hub := events.NewHub[index.Event]()
	changed := make(chan struct{}, 1)
	tracker.onChange = func() { changed <- struct{}{} }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go tracker.Run(ctx, hub.Subscribe)
	time.Sleep(50 * time.Millisecond)

	write(t, filepath.Join(root, "proj", "idle", "docs", "plan.md"), "edited in idle")
	hub.Publish(index.Event{Kind: index.Changed, Path: "proj/idle/docs/plan.md"})

	select {
	case <-changed:
	case <-time.After(3 * time.Second):
		t.Fatal("no change reported")
	}
	if _, ok := tracker.Changed("proj/idle", "docs/plan.md"); !ok {
		t.Fatal("edit in idle not tracked")
	}
}
