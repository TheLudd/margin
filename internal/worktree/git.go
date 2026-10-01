package worktree

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var markdown = []string{"--", ":(icase)*.md"}

func git(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", append([]string{"-c", "core.quotepath=off"}, args...)...)
	cmd.Dir = dir
	return cmd.Output()
}

func gitLine(dir string, args ...string) (string, error) {
	out, err := git(dir, args...)
	return strings.TrimSpace(string(out)), err
}

// names runs a git command printing NUL-separated paths.
func names(dir string, args ...string) map[string]bool {
	out, err := git(dir, append(args, markdown...)...)
	set := map[string]bool{}
	if err != nil {
		return set
	}
	for name := range bytes.SplitSeq(out, []byte{0}) {
		if len(name) > 0 {
			set[string(name)] = true
		}
	}
	return set
}

// mainCheckout returns the main checkout of the repository at abs: abs itself
// when .git is a directory, or the checkout a linked worktree's .git file
// points to.
func mainCheckout(abs string) (string, bool) {
	gitPath := filepath.Join(abs, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return "", false
	}
	if info.IsDir() {
		return abs, true
	}
	data, err := os.ReadFile(gitPath)
	if err != nil {
		return "", false
	}
	gitdir, found := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir: ")
	if !found {
		return "", false
	}
	// <main>/.git/worktrees/<name>
	common := filepath.Dir(filepath.Dir(gitdir))
	if filepath.Base(common) != ".git" {
		return "", false
	}
	return filepath.Dir(common), true
}

// uncommitted returns the markdown files with uncommitted changes in the
// checkout at abs, dated by their modification time.
func uncommitted(abs string) map[string]time.Time {
	changed := map[string]time.Time{}
	paths := names(abs, "diff", "--name-only", "-z", "HEAD")
	for p := range names(abs, "ls-files", "--others", "--exclude-standard", "-z") {
		paths[p] = true
	}
	for p := range paths {
		if info, err := os.Stat(filepath.Join(abs, p)); err == nil {
			changed[p] = info.ModTime()
		}
	}
	return changed
}

// branchChanges returns the markdown files the worktree at abs changed since
// it forked from base, committed or not. Committed changes are dated by
// their last commit, uncommitted ones by modification time.
func branchChanges(abs, base string) map[string]time.Time {
	changed := uncommitted(abs)
	committed := commitTimes(abs, base)
	for p := range names(abs, "diff", "--name-only", "-z", base) {
		if _, ok := changed[p]; ok {
			continue
		}
		if at, ok := committed[p]; ok {
			changed[p] = at
		} else if info, err := os.Stat(filepath.Join(abs, p)); err == nil {
			changed[p] = info.ModTime()
		}
	}
	return changed
}

// commitTimes returns, for each markdown file touched in base..HEAD, the time
// of the newest commit touching it.
func commitTimes(abs, base string) map[string]time.Time {
	out, err := git(abs, append([]string{"log", "--format=\x01%ct", "--name-only", base + "..HEAD"}, markdown...)...)
	times := map[string]time.Time{}
	if err != nil {
		return times
	}
	var current time.Time
	lines := bufio.NewScanner(bytes.NewReader(out))
	for lines.Scan() {
		line := lines.Text()
		if stamp, ok := strings.CutPrefix(line, "\x01"); ok {
			seconds, _ := strconv.ParseInt(stamp, 10, 64)
			current = time.Unix(seconds, 0)
		} else if line != "" {
			if _, seen := times[line]; !seen {
				times[line] = current
			}
		}
	}
	return times
}
