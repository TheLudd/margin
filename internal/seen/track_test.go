package seen

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"margin/internal/config"
	"margin/internal/events"
	"margin/internal/index"
	"margin/internal/workspace"
)

// track serves root as the root named code and tracks it until the test
// ends, keeping versions read for a day.
func track(t *testing.T, root string) *Store {
	t.Helper()
	return trackStore(t, root, open(t))
}

func trackStore(t *testing.T, root string, s *Store) *Store {
	t.Helper()
	configFile := filepath.Join(t.TempDir(), "config.json")
	config.Save(configFile, config.Config{Roots: []config.Root{{Name: "code", Path: root}}})
	hub := events.NewHub[index.Event]()
	workspaces := workspace.NewManager(configFile, hub.Publish, nil)
	ctx, cancel := context.WithCancel(context.Background())
	tracker := &Tracker{Store: s, Workspace: workspaces.Workspace, Keep: func() time.Duration { return 24 * time.Hour }}
	go tracker.Run(ctx, hub.Subscribe)
	t.Cleanup(func() { cancel(); workspaces.Close() })
	return s
}

// eventually waits for path to have a version read.
func eventually(t *testing.T, s *Store, path string) string {
	t.Helper()
	for range 50 {
		if content, ok, _ := s.Get(path); ok {
			return string(content)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s never seeded", path)
	return ""
}

func TestTrackSeedsIndexedFiles(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.md"), []byte("a"), 0o644)

	s := track(t, root)

	if got := eventually(t, s, "code/a.md"); got != "a" {
		t.Fatalf("got %q", got)
	}
}

func TestTrackSeedsAddedFiles(t *testing.T) {
	root := t.TempDir()
	s := track(t, root)
	time.Sleep(50 * time.Millisecond)

	os.WriteFile(filepath.Join(root, "b.md"), []byte("b"), 0o644)

	if got := eventually(t, s, "code/b.md"); got != "b" {
		t.Fatalf("got %q", got)
	}
}

func TestTrackKeepsWhatWasReadThroughChanges(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.md"), []byte("v1"), 0o644)
	s := track(t, root)
	eventually(t, s, "code/a.md")

	os.WriteFile(filepath.Join(root, "a.md"), []byte("v2"), 0o644)
	time.Sleep(100 * time.Millisecond)

	if got := get(s, "code/a.md"); got != "v1" {
		t.Fatalf("got %q", got)
	}
}

func TestTrackStartsOverFromOldVersions(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.md"), []byte("v2"), 0o644)
	s := open(t)
	s.Put("code/a.md", []byte("v1"))
	old := time.Now().Add(-48 * time.Hour)
	os.Chtimes(s.file("code/a.md"), old, old)
	s = trackStore(t, root, s)

	time.Sleep(100 * time.Millisecond)

	if got := get(s, "code/a.md"); got != "v2" {
		t.Fatalf("got %q", got)
	}
}
