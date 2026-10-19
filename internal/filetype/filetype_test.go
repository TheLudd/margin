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

func TestSuggest(t *testing.T) {
	skills := []string{
		"margin/.claude/skills/commit/SKILL.md",
		"gaius/.claude/skills/commit/SKILL.md",
		"gaius/.claude/skills/fassa-api/SKILL.md",
		"mediatool/.claude/skills/test-stubs/SKILL.md",
		"mediatool/staging/ui/cds/SKILL.md",
	}
	claudes := []string{"margin/CLAUDE.md", "gaius/CLAUDE.md", "mediatool/web/CLAUDE.md"}
	readmes := []string{"margin/readme.md", "gaius/README.md", "a/b/c/readme.md", "x/Readme.md"}
	all := append(append(append([]string{}, skills...), claudes...), readmes...)
	all = append(all, "margin/plan.md", "gaius/plan.md", "notes/one.md")

	t.Run("F-08: names recurring in enough places are suggested, best counts first, named in lower case without .md", func(t *testing.T) {
		got := New(nil).Suggest(all, 3, 10)
		want := []Suggestion{
			{Name: "readme", Match: "readme.md", Count: 4},
			{Name: "skill", Match: ".claude/skills/*/SKILL.md", Count: 4},
			{Name: "claude", Match: "CLAUDE.md", Count: 3},
		}
		if len(got) != len(want) {
			t.Fatalf("got %+v", got)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("got %+v, want %+v", got[i], want[i])
			}
		}
	})

	t.Run("F-08: the pattern fixes the segments a majority share and wildcards the rest; the count is the files it matches", func(t *testing.T) {
		got := New(nil).Suggest(skills, 3, 10)
		if len(got) != 1 || got[0].Match != ".claude/skills/*/SKILL.md" || got[0].Count != 4 {
			t.Fatalf("got %+v", got)
		}
		got = New(nil).Suggest(claudes, 3, 10)
		if len(got) != 1 || got[0].Match != "CLAUDE.md" || got[0].Count != 3 {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("F-08: the pattern reaches at most three segments above the file; a split group whose pattern matches too few is not suggested", func(t *testing.T) {
		deep := []string{"one/platform/ai/mcp/lib/tools/a/description.md", "one/platform/ai/mcp/lib/tools/b/description.md", "one/platform/ai/mcp/lib/tools/c/description.md"}
		got := New(nil).Suggest(deep, 3, 10)
		if len(got) != 1 || got[0].Match != "lib/tools/*/description.md" || got[0].Count != 3 {
			t.Fatalf("got %+v", got)
		}
		split := []string{"infra/services/a/BACKLOG.md", "infra/services/b/BACKLOG.md", "elsewhere/BACKLOG.md"}
		if got := New(nil).Suggest(split, 3, 10); len(got) != 0 {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("F-08: a name a type or an earlier suggestion has is made unique by the nearest fixed folder, else a number", func(t *testing.T) {
		typed := New([]config.Type{{Name: "skill", Match: ".claude/skills/*/SKILL.md"}})
		rest := []string{"demo/registry/a/SKILL.md", "demo/registry/b/SKILL.md", "demo/registry/c/SKILL.md"}
		got := typed.Suggest(append(append([]string{}, skills...), rest...), 3, 10)
		if len(got) != 1 || got[0].Name != "registry-skill" || got[0].Match != "demo/registry/*/SKILL.md" || got[0].Count != 3 {
			t.Fatalf("got %+v", got)
		}
		flat := New([]config.Type{{Name: "claude", Match: "x.md"}})
		got = flat.Suggest(claudes, 3, 10)
		if len(got) != 1 || got[0].Name != "claude-2" {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("F-08: files already typed are not suggested; the limit cuts the list; no paths is an empty list", func(t *testing.T) {
		typed := New([]config.Type{{Name: "skill", Match: "SKILL.md"}})
		for _, s := range typed.Suggest(all, 3, 10) {
			if s.Name == "skill" {
				t.Fatalf("typed name suggested: %+v", s)
			}
		}
		if got := New(nil).Suggest(all, 3, 1); len(got) != 1 || got[0].Name != "readme" {
			t.Fatalf("got %+v", got)
		}
		if got := New(nil).Suggest(nil, 3, 10); got == nil || len(got) != 0 {
			t.Fatalf("got %#v", got)
		}
	})
}
