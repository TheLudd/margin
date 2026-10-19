package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"margin/internal/config"
	"margin/internal/core"
	"margin/internal/guard"
	"margin/internal/index"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func write(t *testing.T, p, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

type env struct {
	t      *testing.T
	home   string
	root   string
	cfg    string
	core   *core.Core
	server *httptest.Server
}

// start runs margin over a temp home with one root, ~/code, holding a git
// repository with readme.md and a plain file notes/n.md.
func start(t *testing.T, cfgJSON string) *env {
	t.Helper()
	home := t.TempDir()
	home, _ = filepath.EvalSymlinks(home)
	root := filepath.Join(home, "code")
	write(t, filepath.Join(root, "repo", "readme.md"), "# Hello\n\nworld\n")
	git(t, filepath.Join(root, "repo"), "init", "-q", "-b", "main")
	git(t, filepath.Join(root, "repo"), "add", ".")
	git(t, filepath.Join(root, "repo"), "commit", "-q", "-m", "init")
	write(t, filepath.Join(root, "notes", "n.md"), "notes\n")
	cfgFile := filepath.Join(home, ".config", "margin", "config.json")
	if cfgJSON == "" {
		cfgJSON = `{"roots":[{"name":"code","path":"~/code"}]}`
	}
	if cfgJSON != "none" {
		write(t, cfgFile, cfgJSON)
	}
	c, err := core.New(core.Options{ConfigFile: cfgFile, StateDir: filepath.Join(home, ".local", "state", "margin"), Home: home, Build: "build-1"})
	if err != nil {
		t.Fatal(err)
	}
	static := fstest.MapFS{
		"index.html":       {Data: []byte("<!doctype html><title>margin</title><script type=module src=/assets/app.js></script>")},
		"assets/app.js":    {Data: []byte("console.log('app')")},
		"assets/style.css": {Data: []byte("body{}")},
	}
	srv := httptest.NewServer(New(c, guard.New("testhost", nil, []string{"margin.local"}), static))
	t.Cleanup(func() { srv.Close(); c.Close() })
	return &env{t: t, home: home, root: root, cfg: cfgFile, core: c, server: srv}
}

func (e *env) do(method, p string, body string, headers map[string]string) (*http.Response, []byte) {
	e.t.Helper()
	req, _ := http.NewRequest(method, e.server.URL+p, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	// httptest serves on 127.0.0.1, which the guard accepts.
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, data
}

func (e *env) get(p string) (*http.Response, []byte) { return e.do("GET", p, "", nil) }

func (e *env) post(p string, body string) (*http.Response, []byte) {
	return e.do("POST", p, body, map[string]string{"Content-Type": "application/json"})
}

func (e *env) lists() core.ListsView {
	e.t.Helper()
	_, data := e.get("/api/lists")
	var l core.ListsView
	if err := json.Unmarshal(data, &l); err != nil {
		e.t.Fatalf("lists: %v: %s", err, data)
	}
	return l
}

func (e *env) doc(p string) core.Doc {
	e.t.Helper()
	res, data := e.get("/api/file" + p)
	if res.StatusCode != 200 {
		e.t.Fatalf("GET %s: %d %s", p, res.StatusCode, data)
	}
	var d core.Doc
	json.Unmarshal(data, &d)
	return d
}

// open reads a file as the browser does when opening it: the view is
// recorded and the copy made from the bytes served.
func (e *env) open(p string) core.Doc {
	e.t.Helper()
	res, data := e.do("GET", "/api/file"+p, "", map[string]string{"X-Margin-Open": "1"})
	if res.StatusCode != 200 {
		e.t.Fatalf("GET %s: %d %s", p, res.StatusCode, data)
	}
	var d core.Doc
	json.Unmarshal(data, &d)
	return d
}

// stream opens the event stream and returns a function that waits for the
// next event of a name, with its data.
func (e *env) stream() (next func(name string) map[string]any, stop func()) {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.server.URL+"/api/events", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	events := make(chan [2]string, 100)
	go func() {
		sc := bufio.NewScanner(res.Body)
		var name, data string
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			case line == "":
				if name != "" {
					events <- [2]string{name, data}
				}
				name, data = "", ""
			}
		}
	}()
	next = func(want string) map[string]any {
		e.t.Helper()
		deadline := time.After(5 * time.Second)
		for {
			select {
			case ev := <-events:
				if ev[0] == want {
					var m map[string]any
					json.Unmarshal([]byte(ev[1]), &m)
					if m == nil {
						m = map[string]any{"raw": ev[1]}
					}
					return m
				}
			case <-deadline:
				e.t.Fatalf("no %q event", want)
				return nil
			}
		}
	}
	return next, func() { res.Body.Close() }
}

func TestGuard(t *testing.T) {
	e := start(t, "")
	t.Run("P-06: a request whose Host does not name margin is refused on every route, the stream and static files included", func(t *testing.T) {
		for _, p := range []string{"/api/lists", "/api/events", "/", "/assets/app.js", "/api/file/code/notes/n.md"} {
			req, _ := http.NewRequest("GET", e.server.URL+p, nil)
			req.Host = "evil.example"
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 403 {
				t.Errorf("%s with a foreign Host: %d", p, res.StatusCode)
			}
		}
	})
	t.Run("P-06, P-04: localhost, the hostname and -host names are accepted", func(t *testing.T) {
		for _, h := range []string{"localhost:1", "testhost", "margin.local"} {
			req, _ := http.NewRequest("GET", e.server.URL+"/api/lists", nil)
			req.Host = h
			res, _ := http.DefaultClient.Do(req)
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Errorf("Host %s: %d", h, res.StatusCode)
			}
		}
	})
	t.Run("P-06: an Origin that does not match the Host is refused", func(t *testing.T) {
		res, _ := e.do("GET", "/api/lists", "", map[string]string{"Origin": "http://evil.example"})
		if res.StatusCode != 403 {
			t.Errorf("foreign origin: %d", res.StatusCode)
		}
		res, _ = e.do("GET", "/api/lists", "", map[string]string{"Origin": e.server.URL})
		if res.StatusCode != 200 {
			t.Errorf("matching origin: %d", res.StatusCode)
		}
	})
	t.Run("P-11: there is no authentication", func(t *testing.T) {
		res, _ := e.get("/api/lists")
		if res.StatusCode != 200 || res.Header.Get("WWW-Authenticate") != "" {
			t.Errorf("got %d", res.StatusCode)
		}
	})
}

func TestFiles(t *testing.T) {
	e := start(t, "")
	t.Run("P-01: the page and its assets are served from the embedded frontend", func(t *testing.T) {
		res, data := e.get("/")
		if res.StatusCode != 200 || !strings.Contains(string(data), "<title>margin") {
			t.Errorf("page: %d %s", res.StatusCode, data)
		}
		res, _ = e.get("/code/repo/readme.md")
		if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
			t.Errorf("document route: %d", res.StatusCode)
		}
		res, _ = e.get("/assets/app.js")
		if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
			t.Errorf("asset: %d %s", res.StatusCode, res.Header.Get("Cache-Control"))
		}
	})
	t.Run("P-10: a file response carries a content-hash etag and no-cache, and If-None-Match answers 304", func(t *testing.T) {
		res, _ := e.get("/api/file/code/notes/n.md")
		etag := res.Header.Get("ETag")
		if res.StatusCode != 200 || !strings.HasPrefix(etag, `"`) || res.Header.Get("Cache-Control") != "no-cache" {
			t.Fatalf("got %d etag %q cc %q", res.StatusCode, etag, res.Header.Get("Cache-Control"))
		}
		if etag != `"`+index.Hash([]byte("notes\n"))[:32]+`"` {
			t.Errorf("etag is not the content hash: %s", etag)
		}
		res, _ = e.do("GET", "/api/file/code/notes/n.md", "", map[string]string{"If-None-Match": etag})
		if res.StatusCode != 304 {
			t.Errorf("If-None-Match: %d", res.StatusCode)
		}
		res, _ = e.do("GET", "/api/file/code/notes/n.md", "", map[string]string{"If-None-Match": `"other"`})
		if res.StatusCode != 200 {
			t.Errorf("stale If-None-Match: %d", res.StatusCode)
		}
	})
	t.Run("P-10, D-03: a write needs If-Match, answers 412 on mismatch and returns the new etag", func(t *testing.T) {
		res, _ := e.do("PUT", "/api/file/code/notes/n.md", "new", nil)
		if res.StatusCode != 428 {
			t.Errorf("without If-Match: %d", res.StatusCode)
		}
		res, _ = e.do("PUT", "/api/file/code/notes/n.md", "new", map[string]string{"If-Match": `"stale"`})
		if res.StatusCode != 412 {
			t.Errorf("mismatch: %d", res.StatusCode)
		}
		doc := e.doc("/code/notes/n.md")
		res, data := e.do("PUT", "/api/file/code/notes/n.md", "notes edited\n", map[string]string{"If-Match": doc.Etag})
		if res.StatusCode != 200 {
			t.Fatalf("write: %d %s", res.StatusCode, data)
		}
		var out map[string]string
		json.Unmarshal(data, &out)
		if out["etag"] != `"`+index.Hash([]byte("notes edited\n"))[:32]+`"` {
			t.Errorf("new etag %q", out["etag"])
		}
		if b, _ := os.ReadFile(filepath.Join(e.root, "notes", "n.md")); string(b) != "notes edited\n" {
			t.Errorf("file holds %q", b)
		}
	})
	t.Run("P-07: a path outside the root is refused and a missing file is 404", func(t *testing.T) {
		os.Symlink(e.home, filepath.Join(e.root, "home"))
		write(t, filepath.Join(e.home, "secret.md"), "s")
		res, _ := e.get("/api/file/code/home/secret.md")
		if res.StatusCode != 403 {
			t.Errorf("symlink out: %d", res.StatusCode)
		}
		res, _ = e.get("/api/file/code/../secret.md")
		if res.StatusCode == 200 {
			t.Errorf("dot-dot: %d", res.StatusCode)
		}
		res, _ = e.get("/api/file/code/notes/gone.md")
		if res.StatusCode != 404 {
			t.Errorf("missing: %d", res.StatusCode)
		}
		res, _ = e.get("/api/file/nope/x.md")
		if res.StatusCode != 404 {
			t.Errorf("unknown root: %d", res.StatusCode)
		}
	})
	t.Run("F-03, F-04, D-14: a document carries its path, name and folder", func(t *testing.T) {
		d := e.doc("/code/repo/readme.md")
		if d.Path != "/code/repo/readme.md" || d.Name != "readme.md" || d.Dir != "repo" || d.Content != "# Hello\n\nworld\n" {
			t.Errorf("got %+v", d)
		}
	})
	t.Run("CH-11: a document says whether it is committed, uncommitted, untracked or outside git", func(t *testing.T) {
		if d := e.doc("/code/repo/readme.md"); d.Git != "committed" {
			t.Errorf("committed: %q", d.Git)
		}
		if d := e.doc("/code/notes/n.md"); d.Git != "" {
			t.Errorf("outside git: %q", d.Git)
		}
		write(t, filepath.Join(e.root, "repo", "new.md"), "n")
		if d := e.doc("/code/repo/new.md"); d.Git != "untracked" {
			t.Errorf("untracked: %q", d.Git)
		}
		write(t, filepath.Join(e.root, "repo", "readme.md"), "# Hello\n\nchanged\n")
		if d := e.doc("/code/repo/readme.md"); d.Git != "uncommitted" {
			t.Errorf("uncommitted: %q", d.Git)
		}
	})
	t.Run("W-04, CH-11: the meta of a file carries its git state, copies and flags without the content", func(t *testing.T) {
		res, data := e.get("/api/meta/code/repo/readme.md")
		if res.StatusCode != 200 || !strings.Contains(string(data), `"git":"uncommitted"`) || strings.Contains(string(data), `"content"`) {
			t.Errorf("meta: %d %s", res.StatusCode, data)
		}
		res, _ = e.get("/api/meta/code/nope.md")
		if res.StatusCode != 404 {
			t.Errorf("missing meta: %d", res.StatusCode)
		}
	})
	t.Run("F-07: typed files are listed and served with their type and the name taken from the path", func(t *testing.T) {
		e2 := start(t, `{"roots":[{"name":"code","path":"~/code"}],"types":[{"name":"note","match":"notes/*.md","mark":"✎"},{"name":"readme","match":"readme.md"}]}`)
		var readme, note core.Doc
		for _, g := range e2.lists().Older {
			for _, f := range g.Files {
				switch f.Path {
				case "/code/repo/readme.md":
					if f.Name != "repo" || f.Dir != "" || f.Type == nil || f.Type.Name != "readme" || f.Type.Mark != "readme" {
						t.Errorf("readme entry %+v %+v", f, f.Type)
					}
					readme = e2.doc(f.Path)
				case "/code/notes/n.md":
					if f.Name != "n.md" || f.Dir != "" || f.Type == nil || f.Type.Mark != "✎" {
						t.Errorf("note entry %+v %+v", f, f.Type)
					}
					note = e2.doc(f.Path)
				}
			}
		}
		if readme.Name != "repo" || readme.Dir != "" || readme.Type == nil || readme.Type.Name != "readme" {
			t.Errorf("readme doc %+v %+v", readme, readme.Type)
		}
		if note.Name != "n.md" || note.Type == nil || note.Type.Name != "note" {
			t.Errorf("note doc %+v %+v", note, note.Type)
		}
		res, data := e2.do("PUT", "/api/settings", `{"roots":[{"name":"code","path":"~/code"}],"types":[{"name":"","match":"x.md"}],"activeDays":14,"unreadDays":30}`, nil)
		if res.StatusCode != 400 || !strings.Contains(string(data), "no name") {
			t.Errorf("invalid type accepted: %d %s", res.StatusCode, data)
		}
	})
	t.Run("F-02: a file left out by an exclude pattern still opens by its path", func(t *testing.T) {
		e2 := start(t, `{"roots":[{"name":"code","path":"~/code"}],"exclude":["n.md"]}`)
		l := e2.lists()
		for _, g := range l.Older {
			for _, f := range g.Files {
				if f.Name == "n.md" {
					t.Error("excluded file listed")
				}
			}
		}
		if d := e2.doc("/code/notes/n.md"); d.Content != "notes\n" {
			t.Error("excluded file does not open")
		}
	})
}

func TestViewsAndCopies(t *testing.T) {
	e := start(t, "")
	p := "/code/notes/n.md"
	abs := filepath.Join(e.root, "notes", "n.md")
	t.Run("CH-02: the copy is made from the bytes served when the file is opened, so a change right after is unread", func(t *testing.T) {
		e2 := start(t, "")
		q := "/code/notes/race.md"
		write(t, filepath.Join(e2.root, "notes", "race.md"), "served\n")
		time.Sleep(300 * time.Millisecond)
		d := e2.open(q)
		write(t, filepath.Join(e2.root, "notes", "race.md"), "changed right after\n")
		time.Sleep(300 * time.Millisecond)
		if d.Content != "served\n" {
			t.Fatalf("served %q", d.Content)
		}
		if d := e2.doc(q); !d.Unread {
			t.Fatal("change right after opening is not unread")
		}
		_, data := e2.get("/api/baseline" + q)
		if string(data) != "served\n" {
			t.Fatalf("copy %q", data)
		}
	})
	t.Run("S-03, CH-02: opening a file records a view and creates the copy; a never-opened file has none", func(t *testing.T) {
		if d := e.doc(p); d.HasCopy {
			t.Fatal("copy before opening")
		}
		if l := e.lists(); len(l.Recent) != 0 {
			t.Fatalf("recent before opening: %+v", l.Recent)
		}
		if d := e.open(p); !d.HasCopy || d.Unread {
			t.Fatalf("on opening %+v", d)
		}
		if d := e.doc(p); !d.HasCopy || d.Unread {
			t.Fatalf("after opening %+v", d)
		}
		l := e.lists()
		if len(l.Recent) != 1 || l.Recent[0].Path != p || l.Recent[0].Kind != "view" {
			t.Fatalf("recent %+v", l.Recent)
		}
	})
	t.Run("S-02, S-01: a change on disk after the copy makes the file modified and unread, timed by its mtime", func(t *testing.T) {
		time.Sleep(1100 * time.Millisecond)
		write(t, abs, "changed outside\n")
		info, _ := os.Stat(abs)
		time.Sleep(300 * time.Millisecond)
		if d := e.doc(p); !d.Unread {
			t.Fatal("not unread")
		}
		l := e.lists()
		if len(l.Recent) != 1 || l.Recent[0].Kind != "modified" || !l.Recent[0].Unread || l.Recent[0].Time != info.ModTime().Unix() {
			t.Fatalf("recent %+v (want time %d)", l.Recent, info.ModTime().Unix())
		}
	})
	t.Run("CH-01, CH-03: the baseline is the copy; mark read replaces it and the entry becomes a view", func(t *testing.T) {
		res, data := e.get("/api/baseline" + p + "?kind=read")
		if res.StatusCode != 200 || string(data) != "notes\n" {
			t.Fatalf("baseline %d %q", res.StatusCode, data)
		}
		e.post("/api/read", `{"path":"`+p+`"}`)
		if d := e.doc(p); d.Unread {
			t.Fatal("still unread after mark read")
		}
		_, data = e.get("/api/baseline" + p)
		if string(data) != "changed outside\n" {
			t.Fatalf("baseline after mark read %q", data)
		}
		if l := e.lists(); l.Recent[0].Kind != "view" || l.Recent[0].Unread {
			t.Fatalf("recent %+v", l.Recent)
		}
	})
	t.Run("CH-03, CH-14: a save in margin advances the copy when it holds no unread changes", func(t *testing.T) {
		d := e.doc(p)
		e.do("PUT", "/api/file"+p, "edited in margin\n", map[string]string{"If-Match": d.Etag})
		if d := e.doc(p); d.Unread {
			t.Fatal("own edit shows as unread")
		}
		_, data := e.get("/api/baseline" + p)
		if string(data) != "edited in margin\n" {
			t.Fatalf("copy %q", data)
		}
	})
	t.Run("CH-03, CH-14: a save while the copy holds unread changes keeps them and takes in the reader's own edit", func(t *testing.T) {
		e.do("PUT", "/api/file"+p, "# T\n\nread para.\n\nother para.\n", map[string]string{"If-Match": e.doc(p).Etag})
		e.post("/api/read", `{"path":"`+p+`"}`)
		write(t, abs, "# T\n\nread para.\n\nother para, changed outside.\n")
		time.Sleep(300 * time.Millisecond)
		d := e.doc(p)
		if !d.Unread {
			t.Fatal("not unread")
		}
		e.do("PUT", "/api/file"+p, "# T\n\nread para, edited by me.\n\nother para, changed outside.\n", map[string]string{"If-Match": d.Etag})
		_, data := e.get("/api/baseline" + p)
		if string(data) != "# T\n\nread para, edited by me.\n\nother para.\n" {
			t.Fatalf("copy after save: %q", data)
		}
		if d := e.doc(p); !d.Unread {
			t.Fatal("unread changes lost")
		}
		e.post("/api/read", `{"path":"`+p+`"}`)
	})
	t.Run("CH-13: toggling manual records the current version as read and manual files are never modified", func(t *testing.T) {
		res, _ := e.post("/api/manual", `{"path":"`+p+`","manual":true}`)
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		write(t, abs, "hand edit\n")
		time.Sleep(300 * time.Millisecond)
		if d := e.doc(p); !d.Manual || d.Unread {
			t.Fatalf("manual %+v", d)
		}
		if l := e.lists(); l.Recent[0].Unread {
			t.Fatal("manual file unread in the sidebar")
		}
		e.post("/api/manual", `{"path":"`+p+`","manual":false}`)
		_, data := e.get("/api/baseline" + p)
		if d := e.doc(p); d.Manual || d.Unread || string(data) != "hand edit\n" {
			t.Fatalf("after toggling off %+v %q", d, data)
		}
	})
	t.Run("S-05: dismissing an entry forgets its view and a later change shows it again", func(t *testing.T) {
		res, _ := e.post("/api/dismiss", `{"path":"`+p+`"}`)
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		if l := e.lists(); len(l.Recent) != 0 {
			t.Fatalf("recent after dismissal %+v", l.Recent)
		}
		time.Sleep(1100 * time.Millisecond)
		write(t, abs, "after dismissal\n")
		time.Sleep(300 * time.Millisecond)
		if l := e.lists(); len(l.Recent) != 1 || !l.Recent[0].Unread {
			t.Fatalf("recent after change %+v", l.Recent)
		}
	})
	t.Run("CH-11, CH-01: the committed baseline comes from HEAD and is absent outside git", func(t *testing.T) {
		res, data := e.get("/api/baseline/code/repo/readme.md?kind=head")
		if res.StatusCode != 200 || string(data) != "# Hello\n\nworld\n" {
			t.Fatalf("head baseline %d %q", res.StatusCode, data)
		}
		res, _ = e.get("/api/baseline/code/notes/n.md?kind=head")
		if res.StatusCode != 404 {
			t.Errorf("outside git: %d", res.StatusCode)
		}
	})
}

func TestStream(t *testing.T) {
	e := start(t, "")
	next, stop := e.stream()
	defer stop()
	t.Run("P-09: the stream starts with the build id", func(t *testing.T) {
		if ev := next("build"); ev["raw"] != "build-1" {
			t.Fatalf("got %v", ev)
		}
	})
	t.Run("N-01, F-05, T-05: a write in place and a rename-write push a file event with the new etag", func(t *testing.T) {
		abs := filepath.Join(e.root, "notes", "n.md")
		write(t, abs, "in place\n")
		ev := next("file")
		if ev["path"] != "/code/notes/n.md" || ev["kind"] != "changed" || ev["etag"] != `"`+index.Hash([]byte("in place\n"))[:32]+`"` {
			t.Fatalf("got %v", ev)
		}
		write(t, abs+".tmp", "renamed\n")
		os.Rename(abs+".tmp", abs)
		ev = next("file")
		if ev["kind"] != "changed" || ev["etag"] != `"`+index.Hash([]byte("renamed\n"))[:32]+`"` {
			t.Fatalf("got %v", ev)
		}
	})
	t.Run("N-01: a save through margin is pushed too, with the saved etag", func(t *testing.T) {
		d := e.doc("/code/notes/n.md")
		res, data := e.do("PUT", "/api/file/code/notes/n.md", "saved\n", map[string]string{"If-Match": d.Etag})
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		var out map[string]string
		json.Unmarshal(data, &out)
		if ev := next("file"); ev["etag"] != out["etag"] {
			t.Fatalf("got %v want %v", ev, out)
		}
	})
	t.Run("N-05, T-05: a commit pushes a head event naming the repository", func(t *testing.T) {
		repo := filepath.Join(e.root, "repo")
		write(t, filepath.Join(repo, "readme.md"), "# Hello\n\ncommitted change\n")
		next("file")
		git(t, repo, "commit", "-q", "-am", "change")
		if ev := next("head"); ev["repo"] != "/code/repo" {
			t.Fatalf("got %v", ev)
		}
	})
	t.Run("N-05, T-05: a branch switch pushes a head event", func(t *testing.T) {
		repo := filepath.Join(e.root, "repo")
		git(t, repo, "checkout", "-q", "-b", "other")
		if ev := next("head"); ev["repo"] != "/code/repo" {
			t.Fatalf("got %v", ev)
		}
	})
	t.Run("S-06, F-05: removing and adding files push events", func(t *testing.T) {
		abs := filepath.Join(e.root, "notes", "n.md")
		os.Remove(abs)
		if ev := next("file"); ev["kind"] != "removed" {
			t.Fatalf("got %v", ev)
		}
		write(t, abs, "back\n")
		if ev := next("file"); ev["kind"] != "added" {
			t.Fatalf("got %v", ev)
		}
	})
	t.Run("S-06: opening, marking read and dismissing push a lists event", func(t *testing.T) {
		e.open("/code/notes/n.md")
		next("lists")
		e.post("/api/read", `{"path":"/code/notes/n.md"}`)
		next("lists")
		e.post("/api/dismiss", `{"path":"/code/notes/n.md"}`)
		next("lists")
	})
}

func TestSettings(t *testing.T) {
	t.Run("C-04: without a config margin serves no roots", func(t *testing.T) {
		e := start(t, "none")
		l := e.lists()
		if len(l.Roots) != 0 || len(l.Older) != 0 {
			t.Fatalf("got %+v", l)
		}
		res, _ := e.get("/api/file/code/notes/n.md")
		if res.StatusCode != 404 {
			t.Errorf("file served without roots: %d", res.StatusCode)
		}
	})
	t.Run("C-09, C-01: the settings carry the config, its defaults and where it is stored", func(t *testing.T) {
		e := start(t, "")
		_, data := e.get("/api/settings")
		var s core.SettingsView
		json.Unmarshal(data, &s)
		if s.File != e.cfg || s.Config.ActiveDays != 14 || s.Config.UnreadDays != 30 || len(s.Config.Roots) != 1 || s.Error != "" {
			t.Fatalf("got %+v", s)
		}
	})
	t.Run("C-02: an invalid save is refused with a message and nothing changes", func(t *testing.T) {
		e := start(t, "")
		before, _ := os.ReadFile(e.cfg)
		res, data := e.do("PUT", "/api/settings", `{"roots":[{"name":"code","path":"~/code"},{"name":"code","path":"~/missing"}],"activeDays":14,"unreadDays":30}`, nil)
		if res.StatusCode != 400 || !strings.Contains(string(data), "used twice") || !strings.Contains(string(data), "does not exist") {
			t.Fatalf("got %d %s", res.StatusCode, data)
		}
		after, _ := os.ReadFile(e.cfg)
		if !bytes.Equal(before, after) {
			t.Error("file changed")
		}
		if l := e.lists(); len(l.Roots) != 1 {
			t.Error("roots changed")
		}
	})
	t.Run("C-07: saving writes the file and re-indexes in place; a change of only the day counts does not re-index", func(t *testing.T) {
		e := start(t, "")
		write(t, filepath.Join(e.home, "notes", "todo.md"), "todo")
		next, stop := e.stream()
		defer stop()
		next("build")
		res, data := e.do("PUT", "/api/settings", `{"roots":[{"name":"code","path":"~/code"},{"name":"notes","path":"~/notes"}],"exclude":[],"activeDays":14,"unreadDays":30}`, nil)
		if res.StatusCode != 200 || !strings.Contains(string(data), `"reindexed":true`) {
			t.Fatalf("got %d %s", res.StatusCode, data)
		}
		next("config")
		l := e.lists()
		if len(l.Roots) != 2 {
			t.Fatalf("roots %+v", l.Roots)
		}
		found := false
		for _, g := range l.Older {
			for _, f := range g.Files {
				if f.Path == "/notes/todo.md" {
					found = true
				}
			}
		}
		if !found {
			t.Fatalf("new root not indexed: %+v", l.Older)
		}
		cfg, _ := config.Load(e.cfg)
		if len(cfg.Roots) != 2 {
			t.Error("file not written")
		}
		res, data = e.do("PUT", "/api/settings", `{"roots":[{"name":"code","path":"~/code"},{"name":"notes","path":"~/notes"}],"exclude":[],"activeDays":7,"unreadDays":30}`, nil)
		if res.StatusCode != 200 || !strings.Contains(string(data), `"reindexed":false`) {
			t.Fatalf("days only: %d %s", res.StatusCode, data)
		}
		if l := e.lists(); l.ActiveDays != 7 {
			t.Error("activeDays not applied")
		}
	})
	t.Run("C-03: a hand edit to the config is picked up live, and a broken one keeps the roots and shows its error", func(t *testing.T) {
		e := start(t, "")
		next, stop := e.stream()
		defer stop()
		next("build")
		write(t, filepath.Join(e.home, "notes", "todo.md"), "todo")
		write(t, e.cfg, `{"roots":[{"name":"notes","path":"~/notes"}]}`)
		next("config")
		l := e.lists()
		if len(l.Roots) != 1 || l.Roots[0].Name != "notes" {
			t.Fatalf("roots %+v", l.Roots)
		}
		write(t, e.cfg, `{"roots": [`)
		next("config")
		if l := e.lists(); len(l.Roots) != 1 || l.Roots[0].Name != "notes" {
			t.Fatalf("roots after broken edit %+v", l.Roots)
		}
		_, data := e.get("/api/settings")
		var s core.SettingsView
		json.Unmarshal(data, &s)
		if !strings.Contains(s.Error, "JSON") {
			t.Fatalf("error not shown: %+v", s)
		}
		write(t, e.cfg, `{"roots":[{"name":"notes","path":"~/nowhere"}]}`)
		next("config")
		_, data = e.get("/api/settings")
		json.Unmarshal(data, &s)
		if !strings.Contains(s.Error, "does not exist") || len(e.lists().Roots) != 1 {
			t.Fatalf("invalid edit: %+v", s)
		}
	})
	t.Run("C-05: suggestions are the visible folders in home holding markdown, served ones left out", func(t *testing.T) {
		e := start(t, "")
		write(t, filepath.Join(e.home, "notes", "a.md"), "a")
		write(t, filepath.Join(e.home, "notes", "b.md"), "b")
		write(t, filepath.Join(e.home, ".hidden", "c.md"), "c")
		write(t, filepath.Join(e.home, "empty", "x.txt"), "x")
		_, data := e.get("/api/suggest")
		var s []map[string]any
		json.Unmarshal(data, &s)
		if len(s) != 1 || s[0]["path"] != "~/notes" || s[0]["count"] != 2.0 {
			t.Fatalf("got %s", data)
		}
	})
	t.Run("C-06: the folder field completes paths as typed", func(t *testing.T) {
		e := start(t, "")
		_, data := e.get("/api/complete?q=~/co")
		if string(bytes.TrimSpace(data)) != `["~/code"]` {
			t.Fatalf("got %s", data)
		}
	})
}
