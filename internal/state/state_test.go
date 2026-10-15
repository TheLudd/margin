package state

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestState(t *testing.T) {
	t.Run("P-03, S-03, S-05: views and dismissals survive a restart", func(t *testing.T) {
		dir := t.TempDir()
		s, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		now := time.Now().Truncate(time.Second)
		s.View("/a.md", now)
		s.View("/b.md", now.Add(-time.Hour))
		s.Dismiss("/b.md", now)
		s2, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		if v := s2.Views(); len(v) != 1 || !v["/a.md"].Equal(now) {
			t.Fatalf("views %v", v)
		}
		if d := s2.Dismissals(); len(d) != 1 || !d["/b.md"].Equal(now) {
			t.Fatalf("dismissals %v", d)
		}
	})

	t.Run("P-03: state files from an older build, or broken ones, do not keep margin from starting", func(t *testing.T) {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "manual.json"), []byte(`["/old/a.md"]`), 0o644)
		os.WriteFile(filepath.Join(dir, "views.json"), []byte(`{"views": [`), 0o644)
		s, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		if !s.Manual("/old/a.md") || len(s.Views()) != 0 {
			t.Fatalf("manual %v views %v", s.ManualSet(), s.Views())
		}
		os.WriteFile(filepath.Join(dir, "manual.json"), []byte(`nonsense`), 0o644)
		if s, err := Open(dir); err != nil || len(s.ManualSet()) != 0 {
			t.Fatalf("broken manual: %v %v", err, s.ManualSet())
		}
	})

	t.Run("CH-13, P-03: manual marks survive a restart and can be cleared", func(t *testing.T) {
		dir := t.TempDir()
		s, _ := Open(dir)
		s.SetManual("/a.md", true)
		s2, _ := Open(dir)
		if !s2.Manual("/a.md") || s2.Manual("/b.md") || len(s2.ManualSet()) != 1 {
			t.Fatal("manual lost")
		}
		s2.SetManual("/a.md", false)
		s3, _ := Open(dir)
		if s3.Manual("/a.md") {
			t.Fatal("manual not cleared")
		}
	})

	t.Run("CH-02, P-03: a copy is stored by path, read back, and its hash known after a restart", func(t *testing.T) {
		dir := t.TempDir()
		s, _ := Open(dir)
		if _, ok := s.Copy("/a.md"); ok {
			t.Fatal("copy before storing")
		}
		s.PutCopy("/a.md", []byte("one"))
		if data, ok := s.Copy("/a.md"); !ok || string(data) != "one" {
			t.Fatal("copy not read back")
		}
		s2, _ := Open(dir)
		if h, ok := s2.CopyHash("/a.md"); !ok || h != hashOf([]byte("one")) {
			t.Fatal("copy hash lost")
		}
		if _, ok := s2.CopyHash("/other.md"); ok {
			t.Fatal("hash for a file without a copy")
		}
		s2.PutCopy("/a.md", []byte("two"))
		if h, _ := s2.CopyHash("/a.md"); h != hashOf([]byte("two")) {
			t.Fatal("copy not replaced")
		}
	})

	t.Run("CH-04: a sweep removes copies not written for unreadDays and keeps newer ones", func(t *testing.T) {
		dir := t.TempDir()
		s, _ := Open(dir)
		s.PutCopy("/old.md", []byte("o"))
		s.PutCopy("/new.md", []byte("n"))
		old := time.Now().Add(-31 * 24 * time.Hour)
		os.Chtimes(filepath.Join(dir, "copies", key("/old.md")), old, old)
		s, _ = Open(dir)
		if removed := s.Sweep(30, time.Now()); removed != 1 {
			t.Fatalf("removed %d", removed)
		}
		if _, ok := s.CopyHash("/old.md"); ok {
			t.Fatal("old copy kept")
		}
		if _, ok := s.CopyHash("/new.md"); !ok {
			t.Fatal("new copy removed")
		}
		if _, err := os.Stat(filepath.Join(dir, "copies", key("/old.md"))); err == nil {
			t.Fatal("old copy file kept")
		}
	})

	t.Run("S-03: views older than 365 days are dropped by a sweep", func(t *testing.T) {
		dir := t.TempDir()
		s, _ := Open(dir)
		now := time.Now()
		s.View("/old.md", now.Add(-366*24*time.Hour))
		s.View("/new.md", now.Add(-364*24*time.Hour))
		s.Sweep(30, now)
		if v := s.Views(); len(v) != 1 || v["/new.md"].IsZero() {
			t.Fatalf("views %v", v)
		}
	})
}
