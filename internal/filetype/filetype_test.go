package filetype

import (
	"testing"

	"margin/internal/config"
)

func TestFileType(t *testing.T) {
	set := New([]config.Type{
		{Name: "claude", Match: "CLAUDE.md"},
		{Name: "skill", Match: ".claude/skills/*/SKILL.md", Mark: "✦"},
		{Name: "agent", Match: ".claude/agents/*.md"},
		{Name: "ideate", Match: "ideate.md"},
		{Name: "", Match: "nameless.md"},
		{Name: "blank", Match: "  "},
	})

	t.Run("F-07: a file without a type is named by its file name and folder", func(t *testing.T) {
		l := set.Label("margin/docs/plan.md")
		if l.Name != "plan.md" || l.Dir != "margin/docs" || l.Type != nil {
			t.Fatalf("got %+v", l)
		}
		l = set.Label("top.md")
		if l.Name != "top.md" || l.Dir != "" || l.Type != nil {
			t.Fatalf("got %+v", l)
		}
	})

	t.Run("F-07: a fixed file name is dropped, the folder above becomes the name; case is ignored", func(t *testing.T) {
		l := set.Label("margin/CLAUDE.md")
		if l.Name != "margin" || l.Dir != "" || l.Type == nil || l.Type.Name != "claude" || l.Type.Mark != "claude" {
			t.Fatalf("got %+v %+v", l, l.Type)
		}
		l = set.Label("margin/web/claude.md")
		if l.Name != "web" || l.Dir != "margin" || l.Type.Name != "claude" {
			t.Fatalf("got %+v", l)
		}
	})

	t.Run("F-07: every fixed segment of a longer pattern is dropped, wildcard segments are kept", func(t *testing.T) {
		l := set.Label("margin/.claude/skills/commit/SKILL.md")
		if l.Name != "commit" || l.Dir != "margin" || l.Type.Name != "skill" || l.Type.Mark != "✦" {
			t.Fatalf("got %+v %+v", l, l.Type)
		}
		l = set.Label("margin/.claude/agents/reviewer.md")
		if l.Name != "reviewer.md" || l.Dir != "margin" || l.Type.Name != "agent" {
			t.Fatalf("got %+v", l)
		}
	})

	t.Run("F-07: a longer pattern does not match a shorter path; the first type wins; nothing left falls back to the file name", func(t *testing.T) {
		if l := set.Label("SKILL.md"); l.Type != nil {
			t.Fatalf("got %+v", l)
		}
		first := New([]config.Type{{Name: "a", Match: "*.md"}, {Name: "b", Match: "x.md"}})
		if l := first.Label("x.md"); l.Type.Name != "a" || l.Name != "x.md" {
			t.Fatalf("got %+v", l)
		}
		l := set.Label("ideate.md")
		if l.Name != "ideate.md" || l.Dir != "" || l.Type.Name != "ideate" {
			t.Fatalf("got %+v", l)
		}
	})

	t.Run("F-07: types without a name or a pattern are skipped; no types means no labels change", func(t *testing.T) {
		if l := set.Label("nameless.md"); l.Type != nil {
			t.Fatalf("got %+v", l)
		}
		if l := New(nil).Label("a/CLAUDE.md"); l.Type != nil || l.Name != "CLAUDE.md" || l.Dir != "a" {
			t.Fatalf("got %+v", l)
		}
	})
}
