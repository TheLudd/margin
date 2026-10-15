// Package paths resolves where margin keeps its config and state (P-02, P-03).
package paths

import "path/filepath"

// ConfigFile returns the config file: the flag if given, else
// $XDG_CONFIG_HOME/margin/config.json, else ~/.config/margin/config.json.
// A relative XDG value is ignored, as the XDG spec says.
func ConfigFile(flag string, env func(string) string, home string) string {
	if flag != "" {
		return flag
	}
	if base := absolute(env("XDG_CONFIG_HOME")); base != "" {
		return filepath.Join(base, "margin", "config.json")
	}
	return filepath.Join(home, ".config", "margin", "config.json")
}

// StateDir returns the state directory: the flag if given, else
// $XDG_STATE_HOME/margin, else ~/.local/state/margin.
func StateDir(flag string, env func(string) string, home string) string {
	if flag != "" {
		return flag
	}
	if base := absolute(env("XDG_STATE_HOME")); base != "" {
		return filepath.Join(base, "margin")
	}
	return filepath.Join(home, ".local", "state", "margin")
}

func absolute(p string) string {
	if p == "" || !filepath.IsAbs(p) {
		return ""
	}
	return p
}
