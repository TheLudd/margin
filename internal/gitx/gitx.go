// Package gitx asks git questions by shelling out: checkouts and worktrees
// (W), committed baselines and file states (CH-11), and where HEAD lives so
// it can be watched (N-05).
package gitx

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// ErrNotRepo is returned for a folder outside any git checkout.
var ErrNotRepo = errors.New("not a git repository")

func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "LC_ALL=C")
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimRight(out.String(), "\n"), nil
}

// IsCheckout reports whether dir holds a .git entry (a folder or, for a
// linked worktree, a file).
func IsCheckout(dir string) bool {
	_, err := os.Lstat(filepath.Join(dir, ".git"))
	return err == nil
}

// Info describes a checkout.
type Info struct {
	Dir       string // the checkout's top folder
	GitDir    string // where its HEAD lives
	CommonDir string // the repository shared by all its worktrees
}

// Main reports whether the checkout is the main one, not a linked worktree.
func (i Info) Main() bool { return i.GitDir == i.CommonDir }

// Describe finds the checkout holding dir.
func Describe(dir string) (Info, error) {
	out, err := run(dir, "rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir")
	if err != nil {
		return Info{}, ErrNotRepo
	}
	lines := strings.Split(out, "\n")
	if len(lines) < 3 {
		return Info{}, ErrNotRepo
	}
	info := Info{Dir: lines[0], GitDir: lines[1], CommonDir: lines[2]}
	if !filepath.IsAbs(info.CommonDir) {
		info.CommonDir = filepath.Join(dir, info.CommonDir)
	}
	for _, p := range []*string{&info.Dir, &info.GitDir, &info.CommonDir} {
		if r, err := filepath.EvalSymlinks(*p); err == nil {
			*p = r
		}
	}
	return info, nil
}

// Worktree is one checkout of a repository.
type Worktree struct {
	Path   string
	Head   string
	Branch string
}

// Worktrees lists the checkouts of the repository holding dir, the main one
// first.
func Worktrees(dir string) ([]Worktree, error) {
	out, err := run(dir, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	var list []Worktree
	var cur *Worktree
	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.HasPrefix(line, "worktree "):
			list = append(list, Worktree{Path: strings.TrimPrefix(line, "worktree ")})
			cur = &list[len(list)-1]
		case cur != nil && strings.HasPrefix(line, "HEAD "):
			cur.Head = strings.TrimPrefix(line, "HEAD ")
		case cur != nil && strings.HasPrefix(line, "branch "):
			cur.Branch = strings.TrimPrefix(line, "branch refs/heads/")
		}
	}
	for i := range list {
		if r, err := filepath.EvalSymlinks(list[i].Path); err == nil {
			list[i].Path = r
		}
	}
	return list, nil
}

// Head returns the commit HEAD points to, or "" in an empty repository.
func Head(dir string) string {
	out, err := run(dir, "rev-parse", "--verify", "-q", "HEAD")
	if err != nil {
		return ""
	}
	return out
}

// MergeBase returns the merge base of two commits.
func MergeBase(dir, a, b string) (string, error) {
	return run(dir, "merge-base", a, b)
}

func nameSet(out string) map[string]bool {
	set := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		if line != "" {
			set[unquote(line)] = true
		}
	}
	return set
}

// unquote undoes git's quoting of unusual paths.
func unquote(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		if u, err := strconv.Unquote(s); err == nil {
			return u
		}
	}
	return s
}

// Untracked lists files git does not know, ignored ones left out.
func Untracked(dir string) (map[string]bool, error) {
	out, err := run(dir, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	return nameSet(out), nil
}

// ChangedSince lists the files whose working copy differs from a commit,
// committed or not, untracked files included.
func ChangedSince(dir, commit string) (map[string]bool, error) {
	out, err := run(dir, "diff", "--name-only", commit, "--")
	if err != nil {
		return nil, err
	}
	set := nameSet(out)
	untracked, err := Untracked(dir)
	if err != nil {
		return nil, err
	}
	for f := range untracked {
		set[f] = true
	}
	return set, nil
}

// Uncommitted lists the files that differ from HEAD, untracked ones included.
// In an empty repository every file is uncommitted.
func Uncommitted(dir string) (map[string]bool, error) {
	if Head(dir) == "" {
		return Untracked(dir)
	}
	return ChangedSince(dir, "HEAD")
}

// CommitTimes returns, for every file touched by the commits in from..to,
// the time of the last commit touching it.
func CommitTimes(dir, from, to string) (map[string]int64, error) {
	out, err := run(dir, "log", "--format=%x00%ct", "--name-only", from+".."+to, "--")
	if err != nil {
		return nil, err
	}
	times := map[string]int64{}
	var current int64
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "\x00") {
			current, _ = strconv.ParseInt(strings.TrimPrefix(line, "\x00"), 10, 64)
			continue
		}
		if line == "" {
			continue
		}
		name := unquote(line)
		if _, seen := times[name]; !seen {
			times[name] = current
		}
	}
	return times, nil
}

// Show returns a file as of a revision.
func Show(dir, rev, rel string) ([]byte, error) {
	cmd := exec.Command("git", "-C", dir, "show", rev+":"+rel)
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git show: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return out.Bytes(), nil
}

// State is how a file stands with git.
type State string

const (
	StateNone        State = ""
	StateCommitted   State = "committed"
	StateUncommitted State = "uncommitted"
	StateUntracked   State = "untracked"
)

// FileState reports whether a file in a checkout is committed, uncommitted
// or untracked.
func FileState(dir, rel string) State {
	out, err := run(dir, "status", "--porcelain", "--ignored", "--", rel)
	if err != nil {
		return StateNone
	}
	if out == "" {
		if Head(dir) == "" {
			return StateUntracked
		}
		return StateCommitted
	}
	code := out[:2]
	if code == "??" || code == "!!" || Head(dir) == "" {
		return StateUntracked
	}
	return StateUncommitted
}

// HeadPaths lists the files that move when HEAD does: HEAD and logs/HEAD of
// the checkout and packed-refs of the repository.
func HeadPaths(info Info) []string {
	return []string{
		filepath.Join(info.GitDir, "HEAD"),
		filepath.Join(info.GitDir, "logs", "HEAD"),
		filepath.Join(info.CommonDir, "packed-refs"),
	}
}
