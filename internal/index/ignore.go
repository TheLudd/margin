package index

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5/plumbing/format/gitignore"
)

// skippedDirs are never scanned, whatever .gitignore says.
var skippedDirs = map[string]bool{".git": true, "node_modules": true}

// ignorer collects the patterns of every .gitignore seen during scanning.
// Each pattern is scoped to the directory its .gitignore lives in, so one
// flat list serves the whole tree.
type ignorer struct {
	patterns []gitignore.Pattern
}

// load adds the patterns of absDir/.gitignore, scoped to rel.
func (ig *ignorer) load(absDir, rel string) {
	data, err := os.ReadFile(filepath.Join(absDir, ".gitignore"))
	if err != nil {
		return
	}
	domain := split(rel)
	for line := range strings.SplitSeq(string(data), "\n") {
		line = strings.TrimRight(line, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		ig.patterns = append(ig.patterns, gitignore.ParsePattern(line, domain))
	}
}

func (ig *ignorer) ignored(rel string, isDir bool) bool {
	if rel == "" {
		return false
	}
	return gitignore.NewMatcher(ig.patterns).Match(split(rel), isDir)
}

func split(rel string) []string {
	if rel == "" {
		return nil
	}
	return strings.Split(rel, "/")
}
