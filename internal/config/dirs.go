package config

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
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
