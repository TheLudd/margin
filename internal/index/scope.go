package index

import (
	"context"
	"io/fs"
	"path/filepath"
	"strings"
)

// scope decides which files under root belong in an index: markdown files
// outside skippedDirs that neither .gitignore nor exclude leave out.
type scope struct {
	root    string
	exclude func(rel string) bool // nil leaves out none
	ignore  ignorer
}

// walk visits the tree at abs, loading each .gitignore on the way. enter is
// called for every directory kept, and an error from it stops the walk. file
// is called for every file that belongs.
func (s *scope) walk(abs string, enter func(abs, rel string) error, file func(abs, rel string)) {
	filepath.WalkDir(abs, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		rel := s.rel(p)
		if d.IsDir() {
			if rel != "" && s.skipDir(rel, d.Name()) {
				return fs.SkipDir
			}
			s.ignore.load(p, rel)
			if err := enter(p, rel); err != nil {
				return fs.SkipAll
			}
			return nil
		}
		if s.wanted(rel) {
			file(p, rel)
		}
		return nil
	})
}

// wanted reports whether the file at rel belongs in the index.
func (s *scope) wanted(rel string) bool {
	return isMarkdown(rel) && !s.ignore.ignored(rel, false) && (s.exclude == nil || !s.exclude(rel))
}

func (s *scope) skipDir(rel, name string) bool {
	return skippedDirs[name] || s.ignore.ignored(rel, true)
}

func (s *scope) rel(abs string) string {
	rel, err := filepath.Rel(s.root, abs)
	if err != nil || rel == "." {
		return ""
	}
	return filepath.ToSlash(rel)
}

func isMarkdown(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), ".md")
}

// Count counts the files an index of dir would hold, stopping early when ctx
// is done. complete is false if it stopped early, making n a lower bound.
func Count(ctx context.Context, dir string, exclude func(rel string) bool) (n int, complete bool) {
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return 0, true
	}
	s := scope{root: resolved, exclude: exclude}
	s.walk(resolved, func(string, string) error { return ctx.Err() }, func(string, string) { n++ })
	return n, ctx.Err() == nil
}
