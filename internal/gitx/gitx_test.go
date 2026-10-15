package gitx

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func write(t *testing.T, p, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// repo makes a repository with one committed file, readme.md.
func repo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	dir, _ = filepath.EvalSymlinks(dir)
	git(t, dir, "init", "-q", "-b", "main")
	write(t, filepath.Join(dir, "readme.md"), "hello\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-q", "-m", "init")
	return dir
}

func TestGit(t *testing.T) {
	t.Run("W-02: a checkout is described with its git dir and common dir, main or linked", func(t *testing.T) {
		main := repo(t)
		info, err := Describe(filepath.Join(main))
		if err != nil || info.Dir != main || !info.Main() || info.CommonDir != filepath.Join(main, ".git") {
			t.Fatalf("got %+v, %v", info, err)
		}
		wt := filepath.Join(filepath.Dir(main), "wt")
		git(t, main, "worktree", "add", "-q", "-b", "feat", wt)
		winfo, err := Describe(wt)
		if err != nil || winfo.Main() || winfo.CommonDir != info.CommonDir || !strings.HasPrefix(winfo.GitDir, filepath.Join(main, ".git", "worktrees")) {
			t.Fatalf("got %+v, %v", winfo, err)
		}
		if _, err := Describe(t.TempDir()); err != ErrNotRepo {
			t.Fatalf("got %v", err)
		}
		if !IsCheckout(main) || !IsCheckout(wt) || IsCheckout(filepath.Join(main, "sub")) {
			t.Error("IsCheckout wrong")
		}
	})

	t.Run("W-01, W-02: worktrees are listed with the main checkout first", func(t *testing.T) {
		main := repo(t)
		wt := filepath.Join(filepath.Dir(main), "wt")
		git(t, main, "worktree", "add", "-q", "-b", "feat", wt)
		list, err := Worktrees(wt)
		if err != nil || len(list) != 2 || list[0].Path != main || list[1].Path != wt || list[1].Branch != "feat" || list[0].Head == "" {
			t.Fatalf("got %+v, %v", list, err)
		}
	})

	t.Run("W-03: changed files since a merge base, uncommitted ones, and commit times", func(t *testing.T) {
		main := repo(t)
		write(t, filepath.Join(main, "a.md"), "a\n")
		write(t, filepath.Join(main, "b.md"), "b\n")
		git(t, main, "add", ".")
		git(t, main, "commit", "-q", "-m", "ab")
		wt := filepath.Join(filepath.Dir(main), "wt")
		git(t, main, "worktree", "add", "-q", "-b", "feat", wt)
		// Main moves on after the branch point.
		write(t, filepath.Join(main, "readme.md"), "hello main\n")
		git(t, main, "commit", "-q", "-am", "main moves")
		// The worktree commits a change to a.md, edits b.md without committing, adds c.md.
		write(t, filepath.Join(wt, "a.md"), "a changed\n")
		git(t, wt, "commit", "-q", "-am", "feat a")
		write(t, filepath.Join(wt, "b.md"), "b edited\n")
		write(t, filepath.Join(wt, "c.md"), "c\n")

		mb, err := MergeBase(wt, "HEAD", Head(main))
		if err != nil || mb == "" {
			t.Fatal(err)
		}
		changed, err := ChangedSince(wt, mb)
		if err != nil || !changed["a.md"] || !changed["b.md"] || !changed["c.md"] || changed["readme.md"] {
			t.Fatalf("changed %v, %v", changed, err)
		}
		unc, err := Uncommitted(wt)
		if err != nil || unc["a.md"] || !unc["b.md"] || !unc["c.md"] {
			t.Fatalf("uncommitted %v, %v", unc, err)
		}
		times, err := CommitTimes(wt, mb, "HEAD")
		if err != nil || times["a.md"] == 0 || times["b.md"] != 0 {
			t.Fatalf("times %v, %v", times, err)
		}
		if time.Since(time.Unix(times["a.md"], 0)) > time.Minute {
			t.Error("commit time off")
		}
	})

	t.Run("CH-11: a file is committed, uncommitted or untracked", func(t *testing.T) {
		main := repo(t)
		if s := FileState(main, "readme.md"); s != StateCommitted {
			t.Errorf("committed: got %q", s)
		}
		write(t, filepath.Join(main, "readme.md"), "changed\n")
		if s := FileState(main, "readme.md"); s != StateUncommitted {
			t.Errorf("uncommitted: got %q", s)
		}
		write(t, filepath.Join(main, "new.md"), "new\n")
		if s := FileState(main, "new.md"); s != StateUntracked {
			t.Errorf("untracked: got %q", s)
		}
		git(t, main, "add", "new.md")
		if s := FileState(main, "new.md"); s != StateUncommitted {
			t.Errorf("staged: got %q", s)
		}
		write(t, filepath.Join(main, ".gitignore"), "ignored.md\n")
		write(t, filepath.Join(main, "ignored.md"), "i\n")
		if s := FileState(main, "ignored.md"); s != StateUntracked {
			t.Errorf("ignored: got %q", s)
		}
		if s := FileState(t.TempDir(), "x.md"); s != StateNone {
			t.Errorf("outside git: got %q", s)
		}
	})

	t.Run("CH-11, CH-01: the committed version of a file is read from HEAD", func(t *testing.T) {
		main := repo(t)
		write(t, filepath.Join(main, "readme.md"), "changed\n")
		got, err := Show(main, "HEAD", "readme.md")
		if err != nil || string(got) != "hello\n" {
			t.Fatalf("got %q, %v", got, err)
		}
		if _, err := Show(main, "HEAD", "missing.md"); err == nil {
			t.Error("missing file shown")
		}
	})

	t.Run("N-05: HEAD, logs/HEAD and packed-refs of a checkout are the files to watch", func(t *testing.T) {
		main := repo(t)
		info, _ := Describe(main)
		paths := HeadPaths(info)
		want := []string{filepath.Join(main, ".git", "HEAD"), filepath.Join(main, ".git", "logs", "HEAD"), filepath.Join(main, ".git", "packed-refs")}
		for i := range want {
			if paths[i] != want[i] {
				t.Errorf("got %q want %q", paths[i], want[i])
			}
		}
	})

	t.Run("N-05, W-06: a commit, a branch switch and packing refs report the checkout whose HEAD moved", func(t *testing.T) {
		main := repo(t)
		wt := filepath.Join(filepath.Dir(main), "wt")
		git(t, main, "worktree", "add", "-q", "-b", "feat", wt)
		moved := make(chan string, 10)
		hw, err := WatchHeads(func(c string) { moved <- c })
		if err != nil {
			t.Fatal(err)
		}
		defer hw.Close()
		minfo, _ := Describe(main)
		winfo, _ := Describe(wt)
		hw.Add(minfo)
		hw.Add(winfo)

		expect := func(want string) {
			t.Helper()
			select {
			case got := <-moved:
				if got != want {
					t.Fatalf("got %q want %q", got, want)
				}
			case <-time.After(3 * time.Second):
				t.Fatalf("no move reported for %s", want)
			}
		}
		write(t, filepath.Join(wt, "readme.md"), "wt\n")
		git(t, wt, "commit", "-q", "-am", "wt commit")
		expect(wt)
		git(t, main, "checkout", "-q", "-b", "other")
		expect(main)
		git(t, main, "pack-refs", "--all")
		// packed-refs is shared: both checkouts are concerned.
		got := map[string]bool{<-moved: true, <-moved: true}
		if !got[main] || !got[wt] {
			t.Fatalf("pack-refs reported %v", got)
		}
	})
}
