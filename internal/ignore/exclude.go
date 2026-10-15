package ignore

import (
	"path"
	"strings"
)

// Exclude is the config's exclude patterns (F-02). A pattern without a slash
// matches file names anywhere; one with a slash matches the end of a path.
// Case is ignored.
type Exclude struct {
	names []string
	tails []string
}

// NewExclude compiles the patterns.
func NewExclude(patterns []string) Exclude {
	var e Exclude
	for _, p := range patterns {
		p = strings.ToLower(strings.Trim(strings.TrimSpace(p), "/"))
		if p == "" {
			continue
		}
		if strings.Contains(p, "/") {
			e.tails = append(e.tails, p)
		} else {
			e.names = append(e.names, p)
		}
	}
	return e
}

// Empty reports whether there are no patterns.
func (e Exclude) Empty() bool { return len(e.names) == 0 && len(e.tails) == 0 }

// Matches reports whether a slash-separated path is excluded.
func (e Exclude) Matches(p string) bool {
	p = strings.ToLower(strings.Trim(p, "/"))
	parts := strings.Split(p, "/")
	name := parts[len(parts)-1]
	for _, pat := range e.names {
		if ok, _ := path.Match(pat, name); ok {
			return true
		}
	}
	for _, pat := range e.tails {
		n := strings.Count(pat, "/") + 1
		if n > len(parts) {
			continue
		}
		tail := strings.Join(parts[len(parts)-n:], "/")
		if ok, _ := path.Match(pat, tail); ok {
			return true
		}
	}
	return false
}
