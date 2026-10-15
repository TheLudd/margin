package ignore

import (
	"strings"
	"testing"
)

func stack(layers ...[2]string) *Stack {
	var s *Stack
	for _, l := range layers {
		s = s.Push(l[0], Parse(strings.NewReader(l[1])))
	}
	return s
}

func TestGitignore(t *testing.T) {
	t.Run("F-01: a bare name matches files and folders at any depth", func(t *testing.T) {
		s := stack([2]string{"", "build\n*.log\n"})
		for _, p := range []string{"build", "a/build", "x.log", "a/b/x.log", "build/out.md"} {
			isDir := p == "build" || p == "a/build"
			if !s.Ignored(p, isDir) {
				t.Errorf("%q should be ignored", p)
			}
		}
		if s.Ignored("builder/x.md", false) || s.Ignored("x.md", false) {
			t.Error("non-matching path ignored")
		}
	})
	t.Run("F-01: a pattern with a slash is anchored to its .gitignore's folder", func(t *testing.T) {
		s := stack([2]string{"", "/docs/gen\nsub/*.md\n"})
		if !s.Ignored("docs/gen/a.md", false) || !s.Ignored("sub/a.md", false) {
			t.Error("anchored pattern missed")
		}
		if s.Ignored("x/docs/gen/a.md", false) || s.Ignored("x/sub/a.md", false) {
			t.Error("anchored pattern matched deeper")
		}
	})
	t.Run("F-01: a trailing slash matches only folders", func(t *testing.T) {
		s := stack([2]string{"", "tmp/\n"})
		if !s.Ignored("tmp/a.md", false) || !s.Ignored("tmp", true) {
			t.Error("folder pattern missed")
		}
		if s.Ignored("tmp", false) {
			t.Error("folder pattern matched a file")
		}
	})
	t.Run("F-01: negation re-includes, last match wins", func(t *testing.T) {
		s := stack([2]string{"", "*.md\n!keep.md\n"})
		if !s.Ignored("a.md", false) || s.Ignored("keep.md", false) {
			t.Error("negation wrong")
		}
	})
	t.Run("F-01: double stars span folders", func(t *testing.T) {
		s := stack([2]string{"", "a/**/z.md\nout/**\n**/deep\n"})
		for _, p := range []string{"a/z.md", "a/b/c/z.md", "out/x.md", "out/y/x.md", "deep", "q/deep"} {
			if !s.Ignored(p, false) {
				t.Errorf("%q should be ignored", p)
			}
		}
	})
	t.Run("F-01: nested .gitignore files apply within their folder and override outer ones", func(t *testing.T) {
		s := stack([2]string{"", "*.md\n"}, [2]string{"notes", "!*.md\n"})
		if s.Ignored("notes/a.md", false) {
			t.Error("inner negation ignored")
		}
		if !s.Ignored("other/a.md", false) {
			t.Error("outer pattern lost")
		}
		s2 := stack([2]string{"", ""}, [2]string{"notes", "secret.md\n"})
		if !s2.Ignored("notes/secret.md", false) || s2.Ignored("secret.md", false) {
			t.Error("inner scope wrong")
		}
	})
	t.Run("F-01: comments, blanks and escapes are handled", func(t *testing.T) {
		s := stack([2]string{"", "# comment\n\n\\#literal\n\\!bang\n"})
		if !s.Ignored("#literal", false) || !s.Ignored("!bang", false) || s.Ignored("comment", false) {
			t.Error("escapes wrong")
		}
	})
	t.Run("F-01: .git and node_modules are never entered", func(t *testing.T) {
		if !Skipped(".git") || !Skipped("node_modules") || Skipped("src") {
			t.Error("Skipped wrong")
		}
	})
}

func TestExclude(t *testing.T) {
	e := NewExclude([]string{"CHANGELOG.md", "generated/*.md", "*.draft.md", "/docs/internal/*"})
	t.Run("F-02: a pattern without a slash matches file names anywhere, ignoring case", func(t *testing.T) {
		for _, p := range []string{"code/x/changelog.md", "CHANGELOG.md", "a/b/c/ChangeLog.MD", "notes/x.Draft.md"} {
			if !e.Matches(p) {
				t.Errorf("%q should match", p)
			}
		}
		if e.Matches("code/x/changelog.md.bak") || e.Matches("code/changelog/x.md") {
			t.Error("name pattern matched too much")
		}
	})
	t.Run("F-02: a pattern with a slash matches the end of a path", func(t *testing.T) {
		if !e.Matches("code/foo/generated/a.md") || !e.Matches("generated/a.md") || !e.Matches("x/docs/internal/y.md") {
			t.Error("tail pattern missed")
		}
		if e.Matches("code/generated/sub/a.md") || e.Matches("code/xgenerated/a.md") {
			t.Error("tail pattern matched too much")
		}
	})
	t.Run("F-02: no patterns excludes nothing", func(t *testing.T) {
		if !NewExclude(nil).Empty() || NewExclude([]string{" ", ""}).Matches("a.md") {
			t.Error("empty wrong")
		}
	})
}
