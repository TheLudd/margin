// Package textdiff compares texts line by line and rebases an edit from one
// version onto another (CH-03, CH-14): the copy as last read absorbs the
// reader's edit while keeping the changes the reader has not seen.
package textdiff

import "strings"

// Op is one step of an edit script.
type Op struct {
	Kind byte // '=' equal, '-' only in a, '+' only in b
	A    int  // line index in a (for '=' and '-')
	B    int  // line index in b (for '=' and '+')
}

// Lines splits a text into lines, keeping line endings attached.
func Lines(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.SplitAfter(s, "\n")
	if parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	return parts
}

// Diff computes a shortest edit script between two line slices (Myers).
func Diff(a, b []string) []Op {
	n, m := len(a), len(b)
	max := n + m
	if max == 0 {
		return nil
	}
	offset := max
	v := make([]int, 2*max+2)
	var trace [][]int
	for d := 0; d <= max; d++ {
		snapshot := make([]int, len(v))
		copy(snapshot, v)
		trace = append(trace, snapshot)
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
				x = v[offset+k+1]
			} else {
				x = v[offset+k-1] + 1
			}
			y := x - k
			for x < n && y < m && a[x] == b[y] {
				x++
				y++
			}
			v[offset+k] = x
			if x >= n && y >= m {
				return backtrack(trace, a, b, offset)
			}
		}
	}
	return nil
}

func backtrack(trace [][]int, a, b []string, offset int) []Op {
	x, y := len(a), len(b)
	var ops []Op
	for d := len(trace) - 1; d >= 0; d-- {
		v := trace[d]
		k := x - y
		var prevK int
		if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
			prevK = k + 1
		} else {
			prevK = k - 1
		}
		prevX := v[offset+prevK]
		prevY := prevX - prevK
		for x > prevX && y > prevY {
			x--
			y--
			ops = append(ops, Op{Kind: '=', A: x, B: y})
		}
		if d > 0 {
			if x == prevX {
				y--
				ops = append(ops, Op{Kind: '+', B: y, A: x})
			} else {
				x--
				ops = append(ops, Op{Kind: '-', A: x, B: y})
			}
		}
	}
	for i, j := 0, len(ops)-1; i < j; i, j = i+1, j-1 {
		ops[i], ops[j] = ops[j], ops[i]
	}
	return ops
}

// Rebase applies the edit from base to edited onto target, where target
// and base differ by changes the reader has not seen. Every hunk of the
// edit whose context lines in base are also present, unchanged and
// contiguous in target is applied there; the others are left out. The
// result keeps target's unseen changes and takes the reader's edit.
func Rebase(target, base, edited string) string {
	t, b, e := Lines(target), Lines(base), Lines(edited)
	// Where each base line sits in target, when it is shared.
	baseToTarget := make([]int, len(b))
	for i := range baseToTarget {
		baseToTarget[i] = -1
	}
	for _, op := range Diff(t, b) {
		if op.Kind == '=' {
			baseToTarget[op.B] = op.A
		}
	}
	// The edit as hunks over base: [start, end) replaced by lines of edited.
	type hunk struct {
		start, end int
		lines      []string
	}
	var hunks []hunk
	ops := Diff(b, e)
	for i := 0; i < len(ops); {
		if ops[i].Kind == '=' {
			i++
			continue
		}
		h := hunk{start: -1}
		for i < len(ops) && ops[i].Kind != '=' {
			op := ops[i]
			if op.Kind == '-' {
				if h.start < 0 {
					h.start = op.A
				}
				h.end = op.A + 1
			} else {
				if h.start < 0 {
					h.start, h.end = op.A, op.A
				}
				h.lines = append(h.lines, e[op.B])
			}
			i++
		}
		hunks = append(hunks, h)
	}
	// Apply the hunks to target, last first so earlier positions hold.
	out := append([]string(nil), t...)
	for i := len(hunks) - 1; i >= 0; i-- {
		h := hunks[i]
		var from, to int
		if h.end > h.start {
			// Replaced lines must be shared and contiguous in target.
			from = baseToTarget[h.start]
			if from < 0 {
				continue
			}
			ok := true
			for j := h.start; j < h.end; j++ {
				if baseToTarget[j] != from+(j-h.start) {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
			to = from + (h.end - h.start)
		} else {
			// A pure insertion goes after the preceding shared line, or at
			// the start when there is none.
			from = anchor(baseToTarget, h.start)
			if from < 0 {
				continue
			}
			to = from
		}
		replaced := append([]string(nil), out[:from]...)
		replaced = append(replaced, h.lines...)
		replaced = append(replaced, out[to:]...)
		out = replaced
	}
	return strings.Join(out, "")
}

// anchor finds where an insertion before base line i lands in target: right
// after the previous shared line, or at 0 when inserting at the top of a
// shared head; -1 when the surrounding lines are not shared.
func anchor(baseToTarget []int, i int) int {
	if i == 0 {
		return 0
	}
	if i-1 < len(baseToTarget) && baseToTarget[i-1] >= 0 {
		return baseToTarget[i-1] + 1
	}
	return -1
}
