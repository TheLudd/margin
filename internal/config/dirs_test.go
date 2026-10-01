package config

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestSuggestDirs(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, dir := range []string{"code", "Codex", "docs", ".config", "code/gaius"} {
		os.MkdirAll(filepath.Join(home, dir), 0o755)
	}
	os.WriteFile(filepath.Join(home, "cookbook.md"), nil, 0o644)

	cases := map[string][]string{
		"~/co":        {"~/Codex", "~/code"},
		"~/":          {"~/Codex", "~/code", "~/docs"},
		"":            {"~/Codex", "~/code", "~/docs"},
		"~/.c":        {"~/.config"},
		"~/code/":     {"~/code/gaius"},
		home + "/do":  {home + "/docs"},
		"~/nothing/x": {},
	}
	for input, want := range cases {
		if got := SuggestDirs(input, 10); !slices.Equal(got, want) {
			t.Errorf("%q: got %v, want %v", input, got, want)
		}
	}
	if got := SuggestDirs("~/", 1); len(got) != 1 {
		t.Errorf("limit: got %v", got)
	}
}
