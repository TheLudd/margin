// Package filetype names files whose own name says little (F-07): a
// CLAUDE.md is every project's, a SKILL.md every skill's. A type matches a
// pattern; a file of a type is labelled by the part of its path the pattern
// does not fix, and carries the type's mark.
package filetype

import (
	"path"
	"strings"

	"margin/internal/config"
)

// Type is a configured file type as shown: its name and the mark drawn
// before the file name.
type Type struct {
	Name string `json:"name"`
	Mark string `json:"mark"`
}

// Label is how a file is shown: the name, the folder above it, and the type
// when it has one.
type Label struct {
	Name string
	Dir  string
	Type *Type
}

type pattern struct {
	typ      Type
	segments []string // lower case, the last is the file name pattern
	anywhere bool     // a single segment matches the file name anywhere
}

// Set is the compiled types, in config order; the first match wins.
type Set struct {
	patterns []pattern
}

// New compiles the configured types. A mark left empty is the name.
func New(types []config.Type) Set {
	var s Set
	for _, t := range types {
		m := strings.ToLower(strings.Trim(strings.TrimSpace(t.Match), "/"))
		if m == "" || strings.TrimSpace(t.Name) == "" {
			continue
		}
		typ := Type{Name: strings.TrimSpace(t.Name), Mark: strings.TrimSpace(t.Mark)}
		if typ.Mark == "" {
			typ.Mark = typ.Name
		}
		segs := strings.Split(m, "/")
		s.patterns = append(s.patterns, pattern{typ: typ, segments: segs, anywhere: len(segs) == 1})
	}
	return s
}

// Label resolves a slash-separated path. Without a matching type the name
// is the file name and the dir what is above it, "" at the top. With one,
// the pattern's fixed segments are dropped from the path: the name is the
// rightmost segment left, the dir the rest. A fixed segment has no
// wildcard. Nothing left falls back to the file name.
func (s Set) Label(rel string) Label {
	parts := strings.Split(strings.Trim(rel, "/"), "/")
	plain := Label{Name: parts[len(parts)-1], Dir: dirOf(parts[:len(parts)-1])}
	for i := range s.patterns {
		p := &s.patterns[i]
		if !p.matches(parts) {
			continue
		}
		kept := p.strip(parts)
		if len(kept) == 0 {
			plain.Type = &p.typ
			return plain
		}
		typ := p.typ
		return Label{Name: kept[len(kept)-1], Dir: dirOf(kept[:len(kept)-1]), Type: &typ}
	}
	return plain
}

// Type reports the type of a path, nil without one.
func (s Set) Type(rel string) *Type { return s.Label(rel).Type }

func (p *pattern) matches(parts []string) bool {
	n := len(p.segments)
	if n > len(parts) {
		return false
	}
	tail := parts[len(parts)-n:]
	for i, seg := range p.segments {
		if ok, _ := path.Match(seg, strings.ToLower(tail[i])); !ok {
			return false
		}
	}
	return true
}

// strip drops the path segments the pattern fixes.
func (p *pattern) strip(parts []string) []string {
	n := len(p.segments)
	start := len(parts) - n
	var kept []string
	kept = append(kept, parts[:start]...)
	for i, seg := range p.segments {
		if hasWildcard(seg) {
			kept = append(kept, parts[start+i])
		}
	}
	return kept
}

func hasWildcard(seg string) bool { return strings.ContainsAny(seg, "*?[") }

func dirOf(parts []string) string { return strings.Join(parts, "/") }
