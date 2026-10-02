package config

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"margin/internal/index"
)

// SuggestDirs completes a partly typed folder path with the folders it could
// name, for the settings screen. Hidden folders are only suggested once a
// dot is typed. Suggestions keep a leading ~ if the input has one.
func SuggestDirs(input string, limit int) []string {
	if input == "" {
		input = "~/"
	}
	expanded := Expand(input)
	dir, prefix := filepath.Dir(expanded), filepath.Base(expanded)
	if strings.HasSuffix(input, "/") || input == "~" {
		dir, prefix = filepath.Clean(expanded), ""
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}
	out := []string{}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(prefix, ".") {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(name), strings.ToLower(prefix)) {
			continue
		}
		path := filepath.Join(dir, name)
		if info, err := os.Stat(path); err != nil || !info.IsDir() {
			continue
		}
		if strings.HasPrefix(input, "~") {
			path = Abbreviate(path)
		}
		out = append(out, path)
	}
	slices.Sort(out)
	return out[:min(limit, len(out))]
}

// Folder is a folder that could be served, with the markdown files it holds.
type Folder struct {
	Path     string `json:"path"`     // with a leading ~
	Files    int    `json:"files"`    // how many files its index would hold
	Complete bool   `json:"complete"` // false if counting ran out of time, making Files a lower bound
}

// HomeFolders lists the visible folders directly in the home folder that hold
// markdown, counting them in parallel until ctx is done.
func HomeFolders(ctx context.Context, exclude func(rel string) bool) []Folder {
	home := Expand("~")
	entries, err := os.ReadDir(home)
	if err != nil {
		return []Folder{}
	}
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		out = []Folder{}
	)
	for _, e := range entries {
		dir := filepath.Join(home, e.Name())
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			continue
		}
		wg.Go(func() {
			files, complete := index.Count(ctx, dir, exclude)
			if files == 0 {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			out = append(out, Folder{Path: Abbreviate(dir), Files: files, Complete: complete})
		})
	}
	wg.Wait()
	slices.SortFunc(out, func(a, b Folder) int { return strings.Compare(a.Path, b.Path) })
	return out
}
