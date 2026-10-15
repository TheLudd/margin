// Package suggest finds the folders in home that hold markdown (C-05) and
// completes folder paths as typed (C-06).
package suggest

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"margin/internal/ignore"
)

// Suggestion is a folder in home with its markdown file count, a lower bound
// when counting ran out of time.
type Suggestion struct {
	Path    string `json:"path"`
	Count   int    `json:"count"`
	Partial bool   `json:"partial"`
}

// Folders suggests the visible folders in home that hold markdown, with a
// count for each, within the time budget. Folders already served, or holding
// a served folder, are left out.
func Folders(home string, served []string, budget time.Duration) []Suggestion {
	entries, err := os.ReadDir(home)
	if err != nil {
		return nil
	}
	deadline := time.Now().Add(budget)
	var mu sync.Mutex
	var out []Suggestion
	var wg sync.WaitGroup
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		abs := filepath.Join(home, e.Name())
		if overlaps(abs, served) {
			continue
		}
		wg.Add(1)
		go func(name, abs string) {
			defer wg.Done()
			count, partial := countMarkdown(abs, deadline)
			if count == 0 && !partial {
				return
			}
			mu.Lock()
			out = append(out, Suggestion{Path: "~/" + name, Count: count, Partial: partial})
			mu.Unlock()
		}(e.Name(), abs)
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func overlaps(dir string, served []string) bool {
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		real = dir
	}
	for _, s := range served {
		if real == s || strings.HasPrefix(real, s+"/") || strings.HasPrefix(s, real+"/") {
			return true
		}
	}
	return false
}

// countMarkdown counts .md files under dir, skipping hidden folders, .git
// and node_modules, until the deadline.
func countMarkdown(dir string, deadline time.Time) (count int, partial bool) {
	var walk func(d string) bool
	walk = func(d string) bool {
		if time.Now().After(deadline) {
			return false
		}
		entries, err := os.ReadDir(d)
		if err != nil {
			return true
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() {
				if strings.HasPrefix(name, ".") || ignore.Skipped(name) {
					continue
				}
				if !walk(filepath.Join(d, name)) {
					return false
				}
			} else if e.Type().IsRegular() && strings.HasSuffix(name, ".md") {
				count++
			}
		}
		return true
	}
	return count, !walk(dir)
}

// Complete lists the folders a typed path could continue as. Hidden folders
// show only once a dot is typed; a leading ~ is kept.
func Complete(typed, home string, limit int) []string {
	if typed == "" || !(strings.HasPrefix(typed, "/") || strings.HasPrefix(typed, "~")) {
		return nil
	}
	if typed == "~" {
		return []string{"~/"}
	}
	dir, prefix := typed, ""
	if !strings.HasSuffix(typed, "/") {
		dir, prefix = filepath.Dir(typed), filepath.Base(typed)
		if dir == "." {
			return nil
		}
	}
	absDir := dir
	if strings.HasPrefix(dir, "~") {
		absDir = home + strings.TrimPrefix(dir, "~")
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && e.Type()&os.ModeSymlink == 0 {
			continue
		}
		if e.Type()&os.ModeSymlink != 0 {
			if info, err := os.Stat(filepath.Join(absDir, name)); err != nil || !info.IsDir() {
				continue
			}
		}
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(prefix, ".") {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(name), strings.ToLower(prefix)) {
			continue
		}
		out = append(out, strings.TrimSuffix(dir, "/")+"/"+name)
	}
	sort.Strings(out)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
