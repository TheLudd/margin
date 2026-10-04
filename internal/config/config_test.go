package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFile(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "/xdg")
	if got := File(); got != "/xdg/margin/config.json" {
		t.Errorf("with XDG_CONFIG_HOME: %s", got)
	}

	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("HOME", "/home/u")
	if got := File(); got != "/home/u/.config/margin/config.json" {
		t.Errorf("without XDG_CONFIG_HOME: %s", got)
	}

	t.Setenv("XDG_CONFIG_HOME", "relative")
	if got := File(); got != "/home/u/.config/margin/config.json" {
		t.Errorf("with a relative XDG_CONFIG_HOME: %s", got)
	}
}

func TestStateDir(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", "/xdg")
	if got := StateDir(); got != "/xdg/margin" {
		t.Errorf("with XDG_STATE_HOME: %s", got)
	}

	t.Setenv("XDG_STATE_HOME", "")
	t.Setenv("HOME", "/home/u")
	if got := StateDir(); got != "/home/u/.local/state/margin" {
		t.Errorf("without XDG_STATE_HOME: %s", got)
	}

	t.Setenv("XDG_STATE_HOME", "relative")
	if got := StateDir(); got != "/home/u/.local/state/margin" {
		t.Errorf("with a relative XDG_STATE_HOME: %s", got)
	}
}

func TestLoadMissingIsEmpty(t *testing.T) {
	c, err := Load(filepath.Join(t.TempDir(), "config.json"))

	if err != nil || len(c.Roots) != 0 {
		t.Fatalf("got %+v, %v", c, err)
	}
}

func TestSaveLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "margin", "config.json")
	want := Config{Roots: []Root{{Name: "code", Path: "~/code"}}}

	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)

	if err != nil || !Equal(got, want) {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestLoadRejectsBrokenFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte("{roots"), 0o644)

	if _, err := Load(path); err == nil {
		t.Fatal("broken config accepted")
	}
}

func TestValidate(t *testing.T) {
	base := t.TempDir()
	for _, dir := range []string{"code", "code/gaius", "notes"} {
		os.MkdirAll(filepath.Join(base, dir), 0o755)
	}
	os.WriteFile(filepath.Join(base, "file.md"), nil, 0o644)
	at := func(rel string) string { return filepath.Join(base, rel) }

	cases := []struct {
		name  string
		roots []Root
		error string // "" when valid
	}{
		{"two roots", []Root{{"code", at("code")}, {"notes", at("notes")}}, ""},
		{"no roots", nil, ""},
		{"bad name", []Root{{"my code", at("code")}}, "use letters"},
		{"empty name", []Root{{"", at("code")}}, "use letters"},
		{"duplicate name", []Root{{"x", at("code")}, {"x", at("notes")}}, "used twice"},
		{"missing folder", []Root{{"x", at("nope")}}, "no such folder"},
		{"file", []Root{{"x", at("file.md")}}, "not a folder"},
		{"nested", []Root{{"code", at("code")}, {"gaius", at("code/gaius")}}, "overlaps"},
		{"same folder", []Root{{"a", at("code")}, {"b", at("code") + "/"}}, "overlaps"},
	}
	for _, c := range cases {
		err := Config{Roots: c.roots}.Validate()
		if c.error == "" && err != nil {
			t.Errorf("%s: unexpected %v", c.name, err)
		}
		if c.error != "" && (err == nil || !strings.Contains(err.Error(), c.error)) {
			t.Errorf("%s: got %v, want %q", c.name, err, c.error)
		}
	}
}

func TestExpandAndAbbreviate(t *testing.T) {
	t.Setenv("HOME", "/home/u")

	if got := Expand("~/code"); got != "/home/u/code" {
		t.Errorf("Expand: %s", got)
	}
	if got := Abbreviate("/home/u/code"); got != "~/code" {
		t.Errorf("Abbreviate: %s", got)
	}
	if got := Abbreviate("/srv/notes"); got != "/srv/notes" {
		t.Errorf("Abbreviate outside home: %s", got)
	}
}

func TestValidateExclude(t *testing.T) {
	if err := (Config{Exclude: []string{"CHANGELOG.md", "*.draft.md"}}).Validate(); err != nil {
		t.Errorf("valid patterns rejected: %v", err)
	}
	if err := (Config{Exclude: []string{"[broken"}}).Validate(); err == nil || !strings.Contains(err.Error(), "not valid") {
		t.Errorf("broken pattern: %v", err)
	}
}

func TestExcluded(t *testing.T) {
	c := Config{Exclude: []string{"CHANGELOG.md", "*.draft.md", "generated/*.md", "  "}}
	cases := map[string]bool{
		"CHANGELOG.md":                     true,
		"mediatool/domain/ui/CHANGELOG.md": true,
		"mediatool/changelog.md":           true, // case is ignored
		"docs/plan.draft.md":               true,
		"api/generated/types.md":           true,
		"generated.md":                     false,
		"api/generated/deep/types.md":      false,
		"docs/plan.md":                     false,
		"CHANGELOG-notes.md":               false,
	}
	for rel, want := range cases {
		if got := c.Excluded(rel); got != want {
			t.Errorf("%s: got %v, want %v", rel, got, want)
		}
	}
}

func TestSaveNormalizes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	Save(path, Config{Exclude: []string{" CHANGELOG.md ", " ", ""}})

	got, _ := Load(path)

	if len(got.Exclude) != 1 || got.Exclude[0] != "CHANGELOG.md" {
		t.Fatalf("got %v", got.Exclude)
	}
}

func TestUnreadDays(t *testing.T) {
	if got := (Config{}).Unread(); got != DefaultUnreadDays {
		t.Errorf("default: %d", got)
	}
	if got := (Config{UnreadDays: 90}).Unread(); got != 90 {
		t.Errorf("set: %d", got)
	}
	for _, days := range []int{-1, MaxUnreadDays + 1} {
		if err := (Config{UnreadDays: days}).Validate(); err == nil {
			t.Errorf("%d days accepted", days)
		}
	}
	if !Equal(Config{}, Config{UnreadDays: DefaultUnreadDays}) {
		t.Error("the default should equal an unset window")
	}
	if Equal(Config{}, Config{UnreadDays: 90}) {
		t.Error("a changed window should differ")
	}
}

func TestActiveDays(t *testing.T) {
	if got := (Config{}).Active(); got != DefaultActiveDays {
		t.Errorf("default: %d", got)
	}
	if got := (Config{ActiveDays: 30}).Active(); got != 30 {
		t.Errorf("set: %d", got)
	}
	for _, days := range []int{-1, MaxActiveDays + 1} {
		if err := (Config{ActiveDays: days}).Validate(); err == nil {
			t.Errorf("%d days accepted", days)
		}
	}
	if !Equal(Config{}, Config{ActiveDays: DefaultActiveDays}) {
		t.Error("the default should equal an unset window")
	}
}
