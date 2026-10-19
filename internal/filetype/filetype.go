// Package filetype names files whose own name says little (F-07) and
// suggests types from the names that recur (F-08). A
// CLAUDE.md is every project's, a SKILL.md every skill's. A type matches a
// pattern; a file of a type is labelled by the part of its path the pattern
// does not fix, and carries the type's mark.
package filetype

import (
	"fmt"
	"math"
	"path"
	"sort"
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

// Suggestion is a type worth adding (F-08): a file name that recurs in many
// places, the pattern that fits most of its files, and how many it matches.
type Suggestion struct {
	Name  string `json:"name"`
	Match string `json:"match"`
	Count int    `json:"count"`
}

// MinPlaces is how many places a file name must recur in to be suggested,
// and how many files its pattern must match; SuggestLimit how many
// suggestions are given; MaxDepth how many segments above the file a
// suggested pattern reaches, so a name in one project is not patterned
// with the project's whole path.
const (
	MinPlaces    = 3
	SuggestLimit = 10
	MaxDepth     = 3
)

// majority is the share of a name's files that must agree on a segment for
// it to be fixed in the suggested pattern, and must reach a depth for it to
// be looked at.
const majority = 2.0 / 3

// Suggest groups the paths, each a place a file is in, by file name and
// suggests a type for every name in at least minPlaces places that the set
// does not already type. The pattern is found walking up from the file, at
// most MaxDepth segments: a segment a majority of the files share is
// fixed, one they do not is a wildcard, and the walk stops where a majority
// has no segment; leading wildcards are dropped. A pattern matching fewer
// than minPlaces files is not suggested. The name is the file name in
// lower case without .md, made unique against the set's types and the
// other suggestions by the nearest fixed folder, else a number. Best
// counts first, at most limit.
func (s Set) Suggest(paths []string, minPlaces, limit int) []Suggestion {
	groups := map[string][]string{}
	spellings := map[string]map[string]int{}
	for _, p := range paths {
		p = strings.Trim(p, "/")
		if p == "" || s.Type(p) != nil {
			continue
		}
		base := p[strings.LastIndex(p, "/")+1:]
		key := strings.ToLower(base)
		groups[key] = append(groups[key], p)
		if spellings[key] == nil {
			spellings[key] = map[string]int{}
		}
		spellings[key][base]++
	}
	var out []Suggestion
	for key, group := range groups {
		if len(group) < minPlaces {
			continue
		}
		match := suggestPattern(group, commonest(spellings[key]))
		count := 0
		probe := New([]config.Type{{Name: key, Match: match}})
		for _, p := range group {
			if probe.Type(p) != nil {
				count++
			}
		}
		if count < minPlaces {
			continue
		}
		out = append(out, Suggestion{Name: strings.TrimSuffix(key, ".md"), Match: match, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > limit {
		out = out[:limit]
	}
	if out == nil {
		out = []Suggestion{}
	}
	taken := map[string]bool{}
	for _, p := range s.patterns {
		taken[strings.ToLower(p.typ.Name)] = true
	}
	for i := range out {
		out[i].Name = uniqueName(out[i], taken)
		taken[out[i].Name] = true
	}
	return out
}

// uniqueName keeps a suggestion's name unless taken; then the nearest
// fixed folder of its pattern is put before it, then a number after it.
func uniqueName(sg Suggestion, taken map[string]bool) string {
	if !taken[sg.Name] {
		return sg.Name
	}
	segs := strings.Split(sg.Match, "/")
	for i := len(segs) - 2; i >= 0; i-- {
		if !hasWildcard(segs[i]) {
			if name := strings.ToLower(segs[i]) + "-" + sg.Name; !taken[name] {
				return name
			}
			break
		}
	}
	for n := 2; ; n++ {
		if name := fmt.Sprintf("%s-%d", sg.Name, n); !taken[name] {
			return name
		}
	}
}

// suggestPattern derives the pattern for files sharing a name.
func suggestPattern(group []string, base string) string {
	parents := make([][]string, len(group))
	for i, p := range group {
		segs := strings.Split(p, "/")
		segs = segs[:len(segs)-1]
		for l, r := 0, len(segs)-1; l < r; l, r = l+1, r-1 {
			segs[l], segs[r] = segs[r], segs[l]
		}
		parents[i] = segs // nearest first
	}
	need := int(math.Ceil(majority * float64(len(group))))
	var above []string // nearest first
	for depth := 0; depth < MaxDepth; depth++ {
		counts := map[string]int{}
		present := 0
		for _, segs := range parents {
			if depth < len(segs) {
				present++
				counts[strings.ToLower(segs[depth])]++
			}
		}
		if present < need {
			break
		}
		seg := commonest(counts)
		if counts[seg] >= need {
			above = append(above, seg)
		} else {
			above = append(above, "*")
		}
	}
	for len(above) > 0 && above[len(above)-1] == "*" {
		above = above[:len(above)-1]
	}
	segs := make([]string, 0, len(above)+1)
	for i := len(above) - 1; i >= 0; i-- {
		segs = append(segs, above[i])
	}
	return strings.Join(append(segs, base), "/")
}

// commonest is the key with the highest count, the smallest on a tie.
func commonest(counts map[string]int) string {
	best := ""
	for k, n := range counts {
		if best == "" || n > counts[best] || (n == counts[best] && k < best) {
			best = k
		}
	}
	return best
}
