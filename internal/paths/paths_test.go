package paths

import "testing"

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestPaths(t *testing.T) {
	t.Run("P-02: config comes from XDG_CONFIG_HOME when it is absolute", func(t *testing.T) {
		got := ConfigFile("", env(map[string]string{"XDG_CONFIG_HOME": "/xdg"}), "/home/u")
		if got != "/xdg/margin/config.json" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("P-02: config falls back to ~/.config", func(t *testing.T) {
		got := ConfigFile("", env(nil), "/home/u")
		if got != "/home/u/.config/margin/config.json" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("P-02: a relative XDG_CONFIG_HOME is ignored", func(t *testing.T) {
		got := ConfigFile("", env(map[string]string{"XDG_CONFIG_HOME": "rel/dir"}), "/home/u")
		if got != "/home/u/.config/margin/config.json" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("P-02, P-04: the -config flag wins over XDG", func(t *testing.T) {
		got := ConfigFile("/custom.json", env(map[string]string{"XDG_CONFIG_HOME": "/xdg"}), "/home/u")
		if got != "/custom.json" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("P-03: state comes from XDG_STATE_HOME when it is absolute", func(t *testing.T) {
		got := StateDir("", env(map[string]string{"XDG_STATE_HOME": "/st"}), "/home/u")
		if got != "/st/margin" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("P-03: state falls back to ~/.local/state", func(t *testing.T) {
		got := StateDir("", env(map[string]string{"XDG_STATE_HOME": "../x"}), "/home/u")
		if got != "/home/u/.local/state/margin" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("P-03, P-04: the -state flag wins", func(t *testing.T) {
		if got := StateDir("/s", env(nil), "/home/u"); got != "/s" {
			t.Fatalf("got %q", got)
		}
	})
}
