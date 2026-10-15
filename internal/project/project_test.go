package project

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"margin/internal/index"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func write(t *testing.T, p, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func root(t *testing.T) index.Root {
	dir := t.TempDir()
	dir, _ = filepath.EvalSymlinks(dir)
	return index.Root{Name: "code", Path: dir}
}

// layout makes code/foo/main with a worktree code/foo/feat and a file in each.
func layout(t *testing.T, r index.Root) (main, feat string) {
	main = filepath.Join(r.Path, "foo", "main")
	feat = filepath.Join(r.Path, "foo", "feat")
	os.MkdirAll(main, 0o755)
	git(t, main, "init", "-q", "-b", "main")
	write(t, filepath.Join(main, "readme.md"), "hello\n")
	write(t, filepath.Join(main, "docs", "guide.md"), "guide\n")
	git(t, main, "add", ".")
	git(t, main, "commit", "-q", "-m", "init")
	git(t, main, "worktree", "add", "-q", "-b", "feat", feat)
	return
}

func files(t *testing.T, r index.Root) []index.File {
	ix, err := index.New([]index.Root{r}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ix.Close()
	return ix.Files()
}

func find(files []index.File, suffix string) index.File {
	for _, f := range files {
		if strings.HasSuffix(f.Abs, suffix) {
			return f
		}
	}
	return index.File{}
}

func TestProjects(t *testing.T) {
	t.Run("W-02: a main checkout and its worktrees laid out as name/worktree are one project called name", func(t *testing.T) {
		r := root(t)
		layout(t, r)
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		pl := m.Place(find(fs, "main/readme.md"))
		if pl.Project == nil || !pl.Project.Git || pl.Project.Rel != "foo" || pl.Rel != "readme.md" || !pl.Checkout.Main || pl.Checkout.Label != "main" {
			t.Fatalf("got %+v", pl)
		}
		pl2 := m.Place(find(fs, "feat/readme.md"))
		if pl2.Project != pl.Project || pl2.Checkout.Main || pl2.Checkout.Label != "feat" || pl2.GroupKey() != pl.GroupKey() || pl.GroupKey() == "" {
			t.Fatalf("got %+v", pl2)
		}
		if len(pl.Project.Checkouts) != 2 || !pl.Project.Checkouts[0].Main {
			t.Fatalf("checkouts %+v", pl.Project.Checkouts)
		}
		if pl.Project.Display(true) != "foo" || pl.Project.Display(false) != "code/foo" {
			t.Fatalf("display %q", pl.Project.Display(true))
		}
	})

	t.Run("W-02: separate clones are separate projects, named by their folder", func(t *testing.T) {
		r := root(t)
		for _, name := range []string{"one", "two"} {
			d := filepath.Join(r.Path, name)
			os.MkdirAll(d, 0o755)
			git(t, d, "init", "-q", "-b", "main")
			write(t, filepath.Join(d, "a.md"), "a\n")
		}
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		a, b := m.Place(find(fs, "one/a.md")), m.Place(find(fs, "two/a.md"))
		if a.Project == b.Project || a.Project.Rel != "one" || b.Project.Rel != "two" || a.GroupKey() != "" {
			t.Fatalf("got %+v %+v", a.Project, b.Project)
		}
	})

	t.Run("W-02: a worktree outside the name/worktree layout belongs to the main checkout's project", func(t *testing.T) {
		r := root(t)
		main := filepath.Join(r.Path, "foo")
		os.MkdirAll(main, 0o755)
		git(t, main, "init", "-q", "-b", "main")
		write(t, filepath.Join(main, "a.md"), "a\n")
		git(t, main, "add", ".")
		git(t, main, "commit", "-q", "-m", "init")
		git(t, main, "worktree", "add", "-q", "-b", "x", filepath.Join(r.Path, "wt", "foo-x"))
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		pl := m.Place(find(fs, "foo-x/a.md"))
		if pl.Project.Rel != "foo" || len(pl.Project.Checkouts) != 2 {
			t.Fatalf("got %+v", pl.Project)
		}
	})

	t.Run("S-04, W-02: a file outside git belongs to the first folder under its root, or the root itself", func(t *testing.T) {
		r := root(t)
		write(t, filepath.Join(r.Path, "top.md"), "t")
		write(t, filepath.Join(r.Path, "scratch", "deep", "n.md"), "n")
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		top, deep := m.Place(find(fs, "top.md")), m.Place(find(fs, "deep/n.md"))
		if top.Project.Rel != "" || top.Project.Display(true) != "code" || top.Rel != "top.md" || top.Checkout != nil {
			t.Fatalf("top %+v", top)
		}
		if deep.Project.Rel != "scratch" || deep.Project.Display(true) != "scratch" || deep.Rel != "deep/n.md" || deep.GroupKey() != "" {
			t.Fatalf("deep %+v", deep)
		}
	})

	t.Run("W-03: a worktree's copy has changed when it differs from the merge base, committed changes dated by commit and uncommitted by mtime", func(t *testing.T) {
		r := root(t)
		main, feat := layout(t, r)
		// Main moves on, so the merge base is behind both HEADs.
		write(t, filepath.Join(main, "other.md"), "o\n")
		git(t, main, "add", ".")
		git(t, main, "commit", "-q", "-m", "main moves")
		write(t, filepath.Join(feat, "readme.md"), "feat change\n")
		git(t, feat, "commit", "-q", "-am", "feat")
		write(t, filepath.Join(feat, "docs", "guide.md"), "edited\n")
		old := time.Now().Add(-48 * time.Hour)
		os.Chtimes(filepath.Join(feat, "docs", "guide.md"), old, old)
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		pl := m.Place(find(fs, "feat/readme.md"))
		m.Recompute(pl.Project)

		s := m.State(pl)
		if !s.Changed || s.Uncommitted || s.CommittedAt.IsZero() || time.Since(s.Time(time.Time{})) > time.Minute {
			t.Fatalf("committed change %+v", s)
		}
		guide := find(fs, "feat/docs/guide.md")
		g := m.State(m.Place(guide))
		if !g.Changed || !g.Uncommitted || !g.Time(guide.Mtime).Equal(guide.Mtime) {
			t.Fatalf("uncommitted change %+v", g)
		}
		if s := m.State(m.Place(find(fs, "main/readme.md"))); s.Changed {
			t.Fatalf("main copy %+v", s)
		}
	})

	t.Run("W-03: the main checkout's copy counts as changed only when uncommitted", func(t *testing.T) {
		r := root(t)
		main, _ := layout(t, r)
		write(t, filepath.Join(main, "readme.md"), "main edit\n")
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		pl := m.Place(find(fs, "main/readme.md"))
		m.Recompute(pl.Project)
		if s := m.State(pl); !s.Changed || !s.Uncommitted {
			t.Fatalf("got %+v", s)
		}
		git(t, main, "commit", "-q", "-am", "committed on main")
		m.Recompute(pl.Project)
		if s := m.State(pl); s.Changed {
			t.Fatalf("after commit %+v", s)
		}
	})

	t.Run("W-06: a project with one checkout has no copy states", func(t *testing.T) {
		r := root(t)
		d := filepath.Join(r.Path, "solo")
		os.MkdirAll(d, 0o755)
		git(t, d, "init", "-q", "-b", "main")
		write(t, filepath.Join(d, "a.md"), "a\n")
		fs := files(t, r)
		m := Build([]index.Root{r}, fs)
		pl := m.Place(find(fs, "solo/a.md"))
		m.Recompute(pl.Project)
		if pl.Project.Multi() || m.State(pl).Changed {
			t.Fatal("solo project has copies")
		}
	})

	t.Run("N-05: every checkout is known for watching", func(t *testing.T) {
		r := root(t)
		layout(t, r)
		m := Build([]index.Root{r}, files(t, r))
		if infos := m.Infos(); len(infos) != 2 {
			t.Fatalf("got %d checkouts", len(infos))
		}
		if p := m.ProjectOfDir(filepath.Join(r.Path, "foo", "feat", "docs")); p == nil || p.Rel != "foo" {
			t.Fatal("ProjectOfDir wrong")
		}
	})
}
