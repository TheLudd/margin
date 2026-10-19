package lists

import (
	"testing"
	"time"

	"margin/internal/config"
	"margin/internal/filetype"
	"margin/internal/index"
	"margin/internal/project"
)

var now = time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

func day(n int) time.Time { return now.Add(-time.Duration(n) * 24 * time.Hour) }

func file(root, rel, hash string, mtime time.Time) index.File {
	return index.File{Abs: "/" + root + "/" + rel, Root: root, Rel: rel, Hash: hash, Mtime: mtime}
}

var plain = &project.Project{Key: "dir:code/", Root: "code"}
var fooProj = &project.Project{Key: "dir:code/foo", Root: "code", Rel: "foo"}

func solo(f index.File, p *project.Project) FileInfo {
	return FileInfo{File: f, Placement: project.Placement{Project: p, Rel: f.Rel}}
}

func base(files ...FileInfo) Input {
	return Input{Files: files, Views: map[string]time.Time{}, Dismissals: map[string]time.Time{}, CopyHash: map[string]string{}, Manual: map[string]bool{}, Now: now, ActiveDays: 14, SingleRoot: true}
}

func TestLists(t *testing.T) {
	t.Run("S-01: Recent lists files viewed or modified within the active window, latest first, timed by whichever happened last", func(t *testing.T) {
		a := file("code", "foo/a.md", "h1", day(20))
		b := file("code", "foo/b.md", "h2", day(1))
		c := file("code", "foo/c.md", "h3", day(30))
		in := base(solo(a, fooProj), solo(b, fooProj), solo(c, fooProj))
		in.Views[a.Abs] = day(2)
		in.CopyHash[b.Abs] = "old"
		in.Views[b.Abs] = day(3)
		in.Views[c.Abs] = day(15)
		l := Build(in)
		if len(l.Recent) != 2 || l.Recent[0].Name != "b.md" || l.Recent[1].Name != "a.md" {
			t.Fatalf("recent %+v", l.Recent)
		}
		if l.Recent[0].Kind != "modified" || l.Recent[0].Time != day(1).Unix() || !l.Recent[0].Unread {
			t.Fatalf("b %+v", l.Recent[0])
		}
		if l.Recent[1].Kind != "view" || l.Recent[1].Time != day(2).Unix() || l.Recent[1].Unread {
			t.Fatalf("a %+v", l.Recent[1])
		}
		if len(l.Older) != 1 || l.Older[0].Project != "foo" || len(l.Older[0].Files) != 1 || l.Older[0].Files[0].Name != "c.md" {
			t.Fatalf("older %+v", l.Older)
		}
	})

	t.Run("S-02: modified means the content differs from the copy; no copy, equal content or manual is not modified", func(t *testing.T) {
		f := file("code", "a.md", "h", day(0))
		if Modified(f, map[string]string{}, nil) {
			t.Error("no copy counted as modified")
		}
		if Modified(f, map[string]string{f.Abs: "h"}, nil) {
			t.Error("equal content counted as modified")
		}
		if !Modified(f, map[string]string{f.Abs: "other"}, map[string]bool{}) {
			t.Error("different content not modified")
		}
		if Modified(f, map[string]string{f.Abs: "other"}, map[string]bool{f.Abs: true}) {
			t.Error("manual file counted as modified")
		}
	})

	t.Run("S-02, S-01: a modification's time is the file's mtime, and a never-opened file sits under Older however new", func(t *testing.T) {
		fresh := file("code", "fresh.md", "h", day(0))
		mod := file("code", "mod.md", "h", day(5))
		in := base(solo(fresh, plain), solo(mod, plain))
		in.CopyHash[mod.Abs] = "old"
		l := Build(in)
		if len(l.Recent) != 1 || l.Recent[0].Name != "mod.md" || l.Recent[0].Time != day(5).Unix() {
			t.Fatalf("recent %+v", l.Recent)
		}
		if len(l.Older) != 1 || l.Older[0].Files[0].Name != "fresh.md" || l.Older[0].Files[0].Unread {
			t.Fatalf("older %+v", l.Older)
		}
	})

	t.Run("S-05: a dismissal hides activity up to then; a later view or change shows the file again", func(t *testing.T) {
		f := file("code", "a.md", "h", day(3))
		in := base(solo(f, plain))
		in.CopyHash[f.Abs] = "old"
		in.Dismissals[f.Abs] = day(2)
		if l := Build(in); len(l.Recent) != 0 || l.Older[0].Files[0].Unread {
			t.Fatalf("dismissed activity shown: %+v", l)
		}
		in.Views[f.Abs] = day(1)
		if l := Build(in); len(l.Recent) != 1 || l.Recent[0].Kind != "view" {
			t.Fatalf("later view hidden: %+v", l)
		}
		delete(in.Views, f.Abs)
		f.Mtime = day(1)
		in.Files = []FileInfo{solo(f, plain)}
		if l := Build(in); len(l.Recent) != 1 || l.Recent[0].Kind != "modified" || !l.Recent[0].Unread {
			t.Fatalf("later change hidden: %+v", l)
		}
	})

	t.Run("S-07: an unread file under Older carries the mark", func(t *testing.T) {
		f := file("code", "a.md", "h", day(20))
		in := base(solo(f, plain))
		in.CopyHash[f.Abs] = "old"
		l := Build(in)
		if len(l.Older) != 1 || !l.Older[0].Files[0].Unread {
			t.Fatalf("got %+v", l)
		}
	})

	t.Run("S-04: Older groups files by project, sorted by name within, projects sorted", func(t *testing.T) {
		in := base(
			solo(file("code", "zeta/b.md", "h", day(40)), &project.Project{Key: "z", Root: "code", Rel: "zeta"}),
			solo(file("code", "alpha/z.md", "h", day(40)), &project.Project{Key: "a", Root: "code", Rel: "alpha"}),
			solo(file("code", "alpha/a.md", "h", day(40)), &project.Project{Key: "a", Root: "code", Rel: "alpha"}),
			solo(file("code", "top.md", "h", day(40)), plain),
		)
		l := Build(in)
		if len(l.Older) != 3 || l.Older[0].Project != "alpha" || l.Older[1].Project != "code" || l.Older[2].Project != "zeta" {
			t.Fatalf("groups %+v", l.Older)
		}
		if l.Older[0].Files[0].Name != "a.md" || l.Older[0].Files[1].Name != "z.md" {
			t.Fatalf("order %+v", l.Older[0].Files)
		}
	})

	t.Run("F-03, F-04: entries carry the name and the folder, the root's name left out with a single root", func(t *testing.T) {
		f := file("code", "foo/docs/a.md", "h", day(40))
		top := file("code", "top.md", "h", day(40))
		in := base(solo(f, fooProj), solo(top, plain))
		l := Build(in)
		var entries []Entry
		for _, g := range l.Older {
			entries = append(entries, g.Files...)
		}
		if entries[0].Name != "top.md" || entries[0].Dir != "" || entries[0].Path != "/code/top.md" {
			t.Fatalf("top %+v", entries[0])
		}
		if entries[1].Name != "a.md" || entries[1].Dir != "foo/docs" || entries[1].Path != "/code/foo/docs/a.md" {
			t.Fatalf("a %+v", entries[1])
		}
		in.SingleRoot = false
		l = Build(in)
		if l.Older[0].Project != "code" || l.Older[1].Project != "code/foo" || l.Older[1].Files[0].Dir != "code/foo/docs" {
			t.Fatalf("multi-root %+v", l.Older)
		}
	})

	t.Run("F-07: a typed file is named by its path and carries its type, alone and with copies, with one root or several", func(t *testing.T) {
		types := filetype.New([]config.Type{{Name: "claude", Match: "CLAUDE.md"}, {Name: "skill", Match: ".claude/skills/*/SKILL.md", Mark: "✦"}})
		cl := file("code", "foo/CLAUDE.md", "h", day(40))
		sk := file("code", "foo/.claude/skills/commit/SKILL.md", "h", day(40))
		in := base(solo(cl, fooProj), solo(sk, fooProj))
		in.Types = types
		files := Build(in).Older[0].Files
		if len(files) != 2 || files[0].Name != "commit" || files[0].Dir != "foo" || files[0].Type == nil || files[0].Type.Mark != "✦" {
			t.Fatalf("skill %+v", files[0])
		}
		if files[1].Name != "foo" || files[1].Dir != "" || files[1].Type == nil || files[1].Type.Name != "claude" || files[1].Type.Mark != "claude" {
			t.Fatalf("claude %+v", files[1])
		}
		in.SingleRoot = false
		files = Build(in).Older[0].Files
		if files[0].Dir != "code/foo" || files[1].Dir != "code" {
			t.Fatalf("multi-root %+v %+v", files[0], files[1])
		}
		proj := &project.Project{Key: "git", Root: "code", Rel: "bar", Git: true}
		main := &project.Checkout{Dir: "/code/bar/main", Label: "main", Main: true}
		feat := &project.Checkout{Dir: "/code/bar/feat", Label: "feat"}
		proj.Checkouts = []*project.Checkout{main, feat}
		mk := func(rel string, c *project.Checkout) FileInfo {
			return FileInfo{File: file("code", rel, "h", day(40)), Placement: project.Placement{Project: proj, Checkout: c, Rel: "CLAUDE.md"}}
		}
		in = base(mk("bar/main/CLAUDE.md", main), mk("bar/feat/CLAUDE.md", feat))
		in.Types = types
		e := Build(in).Older[0].Files[0]
		if e.Copies != 2 || e.Name != "CLAUDE.md" || e.Dir != "bar" || e.Type == nil || e.Type.Name != "claude" {
			t.Fatalf("copies %+v", e)
		}
	})

	t.Run("W-01, W-03, W-05: copies are listed once with a count; Older opens the copy changed last, else main; Recent opens the copy with the latest activity", func(t *testing.T) {
		proj := &project.Project{Key: "git", Root: "code", Rel: "foo", Git: true}
		main := &project.Checkout{Dir: "/code/foo/main", Label: "main", Main: true}
		feat := &project.Checkout{Dir: "/code/foo/feat", Label: "feat"}
		proj.Checkouts = []*project.Checkout{main, feat}
		mf := file("code", "foo/main/docs/a.md", "h", day(40))
		ff := file("code", "foo/feat/docs/a.md", "h2", day(40))
		mk := func(f index.File, c *project.Checkout, changed bool, at time.Time) FileInfo {
			return FileInfo{File: f, Placement: project.Placement{Project: proj, Checkout: c, Rel: "docs/a.md"}, State: project.CopyState{Changed: changed, CommittedAt: at}}
		}
		in := base(mk(mf, main, false, time.Time{}), mk(ff, feat, false, time.Time{}))
		l := Build(in)
		if len(l.Older) != 1 || len(l.Older[0].Files) != 1 {
			t.Fatalf("not listed once: %+v", l.Older)
		}
		e := l.Older[0].Files[0]
		if e.Copies != 2 || e.CopiesChanged || e.Path != "/code/foo/main/docs/a.md" || e.Dir != "foo/docs" || e.Name != "a.md" {
			t.Fatalf("unchanged %+v", e)
		}
		in = base(mk(mf, main, false, time.Time{}), mk(ff, feat, true, day(3)))
		e = Build(in).Older[0].Files[0]
		if !e.CopiesChanged || e.Path != "/code/foo/feat/docs/a.md" {
			t.Fatalf("changed %+v", e)
		}
		in.Views[mf.Abs] = day(1)
		r := Build(in).Recent
		if len(r) != 1 || r[0].Path != "/code/foo/main/docs/a.md" || r[0].Copies != 2 {
			t.Fatalf("recent %+v", r)
		}
	})
}
