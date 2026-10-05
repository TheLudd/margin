package worktree

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"margin/internal/index"
)

// follow runs a tracker of root without index events, reporting every
// repository whose HEAD moved.
func follow(t *testing.T, root string, ix *index.Index) (*Tracker, <-chan string) {
	t.Helper()
	moved := make(chan string, 10)
	tracker := New(root, ix.Files, nil, func(repo string) { moved <- repo })
	tracker.Refresh()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go tracker.Run(ctx, func() (<-chan index.Event, func()) { return make(chan index.Event), func() {} })
	time.Sleep(100 * time.Millisecond) // let it watch
	return tracker, moved
}

func waitFor(t *testing.T, moved <-chan string, repo string) {
	t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case r := <-moved:
			if r == repo {
				return
			}
		case <-timeout:
			t.Fatalf("HEAD of %s never moved", repo)
		}
	}
}

func TestCommitInTheMainCheckout(t *testing.T) {
	root, _, ix := setup(t)
	main := filepath.Join(root, "proj", "master")
	write(t, filepath.Join(main, "CLAUDE.md"), "v3")
	tracker, moved := follow(t, root, ix)

	run(t, main, "git", "commit", "-q", "-am", "v3")

	waitFor(t, moved, "proj/master")
	if _, ok := tracker.Changed("proj/master", "CLAUDE.md"); ok {
		t.Fatal("still uncommitted")
	}
}

func TestCommitInAWorktree(t *testing.T) {
	root, _, ix := setup(t)
	_, moved := follow(t, root, ix)

	run(t, filepath.Join(root, "proj", "feature"), "git", "commit", "-q", "-am", "draft")

	waitFor(t, moved, "proj/feature")
}

func TestCheckout(t *testing.T) {
	root, _, ix := setup(t)
	_, moved := follow(t, root, ix)

	run(t, filepath.Join(root, "solo"), "git", "checkout", "-q", "-b", "other")

	waitFor(t, moved, "solo")
}
