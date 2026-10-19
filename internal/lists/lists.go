// Package lists builds the sidebar's Recent and Older lists (S-01, S-02,
// S-04) and the finder's data from the index, the views and the copies.
package lists

import (
	"sort"
	"time"

	"margin/internal/filetype"
	"margin/internal/index"
	"margin/internal/project"
)

// Entry is a file as listed: once, with its copies counted (W-01).
type Entry struct {
	Path          string         `json:"path"`
	Name          string         `json:"name"`
	Dir           string         `json:"dir"`
	Time          int64          `json:"time,omitempty"`
	Kind          string         `json:"kind,omitempty"`
	Unread        bool           `json:"unread"`
	Copies        int            `json:"copies,omitempty"`
	CopiesChanged bool           `json:"copiesChanged,omitempty"`
	Type          *filetype.Type `json:"type,omitempty"`
	project       string
	sortKey       string
}

// Group is a project's files under Older.
type Group struct {
	Project string  `json:"project"`
	Files   []Entry `json:"files"`
}

// Lists is what the sidebar shows.
type Lists struct {
	Recent []Entry `json:"recent"`
	Older  []Group `json:"older"`
}

// FileInfo is an indexed file with its placement.
type FileInfo struct {
	File      index.File
	Placement project.Placement
	State     project.CopyState
}

// Input is everything the lists are built from.
type Input struct {
	Files      []FileInfo
	Views      map[string]time.Time
	Dismissals map[string]time.Time
	CopyHash   map[string]string
	Manual     map[string]bool
	Now        time.Time
	ActiveDays int
	SingleRoot bool
	Types      filetype.Set
}

// Modified reports whether a file's content differs from its copy as last
// read (S-02): no copy, or marked manual, is never modified.
func Modified(f index.File, copyHash map[string]string, manual map[string]bool) bool {
	h, ok := copyHash[f.Abs]
	return ok && !manual[f.Abs] && h != f.Hash
}

type activity struct {
	time     time.Time
	kind     string
	modified bool
}

func (in Input) activity(f index.File) activity {
	var a activity
	dismissed := in.Dismissals[f.Abs]
	if v, ok := in.Views[f.Abs]; ok && v.After(dismissed) {
		a.time, a.kind = v, "view"
	}
	if Modified(f, in.CopyHash, in.Manual) && f.Mtime.After(dismissed) {
		a.modified = true
		if !f.Mtime.Before(a.time) {
			a.time, a.kind = f.Mtime, "modified"
		}
	}
	return a
}

type member struct {
	info FileInfo
	act  activity
}

// Build computes the lists.
func Build(in Input) Lists {
	groups := map[string][]member{}
	var order []string
	for _, fi := range in.Files {
		key := fi.Placement.GroupKey()
		if key == "" {
			key = "solo:" + fi.File.Abs
		}
		if _, ok := groups[key]; !ok {
			order = append(order, key)
		}
		groups[key] = append(groups[key], member{info: fi, act: in.activity(fi.File)})
	}
	cutoff := in.Now.Add(-time.Duration(in.ActiveDays) * 24 * time.Hour)
	var recent []Entry
	older := map[string][]Entry{}
	for _, key := range order {
		e, active := in.entry(groups[key], cutoff)
		if active {
			recent = append(recent, e)
		} else {
			older[e.project] = append(older[e.project], e)
		}
	}
	sort.SliceStable(recent, func(i, j int) bool { return recent[i].Time > recent[j].Time })
	var out Lists
	out.Recent = recent
	names := make([]string, 0, len(older))
	for n := range older {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		files := older[n]
		sort.Slice(files, func(i, j int) bool {
			if files[i].Name != files[j].Name {
				return files[i].Name < files[j].Name
			}
			return files[i].sortKey < files[j].sortKey
		})
		out.Older = append(out.Older, Group{Project: n, Files: files})
	}
	if out.Recent == nil {
		out.Recent = []Entry{}
	}
	if out.Older == nil {
		out.Older = []Group{}
	}
	return out
}

// entry folds the copies of a file into one entry.
func (in Input) entry(members []member, cutoff time.Time) (Entry, bool) {
	first := members[0]
	pl := first.info.Placement
	e := Entry{project: pl.Project.Display(in.SingleRoot)}
	// The label (F-04, F-07): with copies, from the path within the project
	// under the project's name; alone, from the path within the root.
	if len(members) > 1 {
		e.Copies = len(members)
		l := in.Types.Label(pl.Rel)
		e.Name, e.Type = l.Name, l.Type
		e.Dir = joinDir(pl.Project.Display(in.SingleRoot), l.Dir)
	} else {
		l := in.Types.Label(first.info.File.Rel)
		e.Name, e.Type = l.Name, l.Type
		if in.SingleRoot {
			e.Dir = l.Dir
		} else {
			e.Dir = joinDir(first.info.File.Root, l.Dir)
		}
	}
	e.sortKey = e.Dir
	// Activity: the latest of any copy; the entry opens that copy (W-05).
	var latest member
	for _, m := range members {
		if m.act.modified {
			e.Unread = true
		}
		if m.info.State.Changed {
			e.CopiesChanged = true
		}
		if !m.act.time.IsZero() && m.act.time.After(latest.act.time) {
			latest = m
		}
	}
	if !latest.act.time.IsZero() && latest.act.time.After(cutoff) {
		e.Path = latest.info.File.Path()
		e.Time = latest.act.time.Unix()
		e.Kind = latest.act.kind
		return e, true
	}
	e.Path = choose(members).File.Path()
	return e, false
}

// choose picks the copy that opens (W-03): the one changed last, else the
// main checkout's, else the first.
func choose(members []member) FileInfo {
	var best *member
	for i := range members {
		m := &members[i]
		if !m.info.State.Changed {
			continue
		}
		if best == nil || m.info.State.Time(m.info.File.Mtime).After(best.info.State.Time(best.info.File.Mtime)) {
			best = m
		}
	}
	if best != nil {
		return best.info
	}
	for _, m := range members {
		if m.info.Placement.Checkout != nil && m.info.Placement.Checkout.Main {
			return m.info
		}
	}
	return members[0].info
}

func joinDir(prefix, dir string) string {
	if dir == "" {
		return prefix
	}
	return prefix + "/" + dir
}
