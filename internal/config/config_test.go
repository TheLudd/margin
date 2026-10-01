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
