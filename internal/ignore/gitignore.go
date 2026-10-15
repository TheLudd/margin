// Package ignore decides which files stay out of the index: what a .gitignore
// ignores (F-01) and what the exclude patterns leave out (F-02).
package ignore

import (
	"bufio"
	"io"
	"path"
	"strings"
)

// Skipped reports the folder names never entered: .git and node_modules.
func Skipped(name string) bool {
	return name == ".git" || name == "node_modules"
}

type pattern struct {
	negate  bool
	dirOnly bool
	segs    []string
}

// Patterns is one parsed .gitignore file.
type Patterns struct {
	list []pattern
}

// Parse reads a .gitignore.
func Parse(r io.Reader) *Patterns {
	p := &Patterns{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		if pat, ok := parseLine(sc.Text()); ok {
			p.list = append(p.list, pat)
		}
	}
	return p
}

func parseLine(line string) (pattern, bool) {
	line = strings.TrimRight(line, " \t\r")
	if line == "" || strings.HasPrefix(line, "#") {
		return pattern{}, false
	}
	var pat pattern
	if strings.HasPrefix(line, "!") {
		pat.negate = true
		line = line[1:]
	} else if strings.HasPrefix(line, `\!`) || strings.HasPrefix(line, `\#`) {
		line = line[1:]
	}
	if strings.HasSuffix(line, "/") {
		pat.dirOnly = true
		line = strings.TrimRight(line, "/")
	}
	if line == "" {
		return pattern{}, false
	}
	anchored := strings.Contains(line, "/")
	line = strings.TrimPrefix(line, "/")
	segs := strings.Split(line, "/")
	if !anchored {
		segs = append([]string{"**"}, segs...)
	}
	// Collapse repeated ** segments.
	var out []string
	for _, s := range segs {
		if s == "**" && len(out) > 0 && out[len(out)-1] == "**" {
			continue
		}
		out = append(out, s)
	}
	pat.segs = out
	return pat, true
}

func matchSegs(segs, parts []string) bool {
	if len(segs) == 0 {
		return len(parts) == 0
	}
	if segs[0] == "**" {
		for i := 0; i <= len(parts); i++ {
			if matchSegs(segs[1:], parts[i:]) {
				return true
			}
		}
		return false
	}
	if len(parts) == 0 {
		return false
	}
	ok, err := path.Match(segs[0], parts[0])
	if err != nil || !ok {
		return false
	}
	return matchSegs(segs[1:], parts[1:])
}

// decide returns whether rel (relative to the file's folder) is ignored by
// these patterns: the last matching pattern wins; unknown when none match.
func (p *Patterns) decide(rel string, isDir bool) (ignored, known bool) {
	parts := strings.Split(rel, "/")
	for _, pat := range p.list {
		if pat.dirOnly && !isDir {
			continue
		}
		if matchSegs(pat.segs, parts) {
			ignored, known = !pat.negate, true
		}
	}
	return
}

type scoped struct {
	base string // folder of the .gitignore, relative to the root, "" at the root
	pats *Patterns
}

// Stack is the .gitignore files in force at some folder, outermost first.
type Stack struct {
	layers []scoped
}

// Push returns a new stack with the patterns of a .gitignore at base added.
func (s *Stack) Push(base string, pats *Patterns) *Stack {
	if s == nil {
		s = &Stack{}
	}
	layers := make([]scoped, len(s.layers), len(s.layers)+1)
	copy(layers, s.layers)
	return &Stack{layers: append(layers, scoped{base: base, pats: pats})}
}

// Ignored reports whether rel (relative to the root, slash-separated) is
// ignored, counting an ignored parent folder as ignoring everything in it.
func (s *Stack) Ignored(rel string, isDir bool) bool {
	if s == nil || rel == "" {
		return false
	}
	parts := strings.Split(rel, "/")
	for i := 1; i < len(parts); i++ {
		if s.ignoredOne(strings.Join(parts[:i], "/"), true) {
			return true
		}
	}
	return s.ignoredOne(rel, isDir)
}

func (s *Stack) ignoredOne(rel string, isDir bool) bool {
	ignored := false
	for _, layer := range s.layers {
		sub := rel
		if layer.base != "" {
			if !strings.HasPrefix(rel, layer.base+"/") {
				continue
			}
			sub = rel[len(layer.base)+1:]
		}
		if v, known := layer.pats.decide(sub, isDir); known {
			ignored = v
		}
	}
	return ignored
}
