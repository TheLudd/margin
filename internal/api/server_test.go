package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"margin/internal/config"
	"margin/internal/events"
	"margin/internal/index"
	"margin/internal/recent"
	"margin/internal/workspace"
)

type fixture struct {
	root string // the folder served as the root named code
	url  string
	port int
}

func setup(t *testing.T) fixture {
	t.Helper()
	root := t.TempDir()
	write(t, filepath.Join(root, "repo", "plan.md"), "v1")
	configFile := filepath.Join(t.TempDir(), "config.json")
	config.Save(configFile, config.Config{Roots: []config.Root{{Name: "code", Path: root}}})

	hub := events.NewHub[index.Event]()
	workspaces := workspace.NewManager(configFile, hub.Publish, nil)
	rec, _ := recent.Load(filepath.Join(t.TempDir(), "recent.json"), time.Hour)

	srv := httptest.NewUnstartedServer(nil)
	s := &Server{
		Workspaces: workspaces,
		Recent:     rec,
		Events:     hub,
		Web:        fstest.MapFS{"index.html": {Data: []byte("<app>")}},
		Port:       srv.Listener.Addr().(*net.TCPAddr).Port,
		Hosts:      []string{"margin.local"},
	}
	srv.Config.Handler = s.Handler()
	srv.Start()
	t.Cleanup(func() { srv.Close(); workspaces.Close() })
	return fixture{root: root, url: srv.URL, port: s.Port}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func do(t *testing.T, method, url string, body string, headers map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func bodyOf(res *http.Response) string {
	b, _ := io.ReadAll(res.Body)
	return string(b)
}

func TestTree(t *testing.T) {
	f := setup(t)

	var got []treeEntry
	json.NewDecoder(do(t, "GET", f.url+"/api/tree", "", nil).Body).Decode(&got)

	if len(got) != 1 || got[0].Path != "code/repo/plan.md" || got[0].Repo != "code/repo" || got[0].Project != "code/repo" || !got[0].Main || got[0].Viewed != nil {
		t.Fatalf("got %+v", got)
	}
}

func TestTreeIncludesViews(t *testing.T) {
	f := setup(t)
	do(t, "POST", f.url+"/api/recent?path=code/repo/plan.md", "", nil)

	var got []treeEntry
	json.NewDecoder(do(t, "GET", f.url+"/api/tree", "", nil).Body).Decode(&got)

	if len(got) != 1 || got[0].Viewed == nil {
		t.Fatal("view not reported")
	}
}

func TestReadFile(t *testing.T) {
	f := setup(t)

	res := do(t, "GET", f.url+"/api/file?path=code/repo/plan.md", "", nil)

	if res.StatusCode != 200 || bodyOf(res) != "v1" || res.Header.Get("ETag") == "" {
		t.Fatalf("got %d", res.StatusCode)
	}
	again := do(t, "GET", f.url+"/api/file?path=code/repo/plan.md", "", map[string]string{"If-None-Match": res.Header.Get("ETag")})
	if again.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidate got %d", again.StatusCode)
	}
}

func TestReadFileErrors(t *testing.T) {
	f := setup(t)
	cases := map[string]int{
		"code/repo/missing.md": 404,
		"code/../x.md":         403,
		"other/plan.md":        404,
		"code/repo/plan.txt":   400,
	}
	for path, want := range cases {
		if got := do(t, "GET", f.url+"/api/file?path="+path, "", nil).StatusCode; got != want {
			t.Errorf("%s: got %d, want %d", path, got, want)
		}
	}
}

func TestWriteFile(t *testing.T) {
	f := setup(t)
	etag := do(t, "GET", f.url+"/api/file?path=code/repo/plan.md", "", nil).Header.Get("ETag")

	res := do(t, "PUT", f.url+"/api/file?path=code/repo/plan.md", "v2", map[string]string{"If-Match": etag})

	if res.StatusCode != 204 {
		t.Fatalf("got %d", res.StatusCode)
	}
	content, _ := os.ReadFile(filepath.Join(f.root, "repo", "plan.md"))
	if string(content) != "v2" {
		t.Fatalf("content %q", content)
	}
	stale := do(t, "PUT", f.url+"/api/file?path=code/repo/plan.md", "v3", map[string]string{"If-Match": etag})
	if stale.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("stale write got %d", stale.StatusCode)
	}
	if missing := do(t, "PUT", f.url+"/api/file?path=code/repo/plan.md", "v3", nil); missing.StatusCode != http.StatusPreconditionRequired {
		t.Fatalf("write without If-Match got %d", missing.StatusCode)
	}
}

func TestGuard(t *testing.T) {
	f := setup(t)
	cases := []struct {
		name    string
		headers map[string]string
		want    int
	}{
		{"own origin", map[string]string{"Origin": f.url}, 200},
		{"foreign origin", map[string]string{"Origin": "http://evil.example"}, 403},
		{"foreign host", map[string]string{"Host": "evil.example:80"}, 403},
		{"configured host behind a proxy", map[string]string{"Host": "margin.local", "Origin": "http://margin.local"}, 200},
		{"configured host with port", map[string]string{"Host": fmt.Sprintf("margin.local:%d", f.port)}, 200},
		{"similar host", map[string]string{"Host": "margin.local.evil.example"}, 403},
		{"cross-site fetch", map[string]string{"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors"}, 403},
		{"cross-site link", map[string]string{"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"}, 200},
	}
	for _, c := range cases {
		req, _ := http.NewRequest("GET", f.url+"/code/repo/plan.md", nil)
		for k, v := range c.headers {
			req.Header.Set(k, v)
		}
		if host, ok := c.headers["Host"]; ok {
			req.Host = host
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != c.want {
			t.Errorf("%s: got %d, want %d", c.name, res.StatusCode, c.want)
		}
	}
}

func TestApp(t *testing.T) {
	f := setup(t)

	if body := bodyOf(do(t, "GET", f.url+"/code/repo/plan.md", "", nil)); body != "<app>" {
		t.Fatalf("got %q", body)
	}
	if got := do(t, "GET", f.url+"/code/repo/main.go", "", nil).StatusCode; got != 404 {
		t.Fatalf("non-markdown path got %d", got)
	}
}

func TestRecentLatestKindWins(t *testing.T) {
	f := setup(t)
	recentOf := func() []activity {
		var got []activity
		json.NewDecoder(do(t, "GET", f.url+"/api/recent", "", nil).Body).Decode(&got)
		return got
	}

	if got := recentOf(); len(got) != 1 || got[0].Kind != "modified" {
		t.Fatalf("before viewing: %+v", got)
	}
	do(t, "POST", f.url+"/api/recent?path=code/repo/plan.md", "", nil)
	if got := recentOf(); len(got) != 1 || got[0].Path != "code/repo/plan.md" || got[0].Kind != "viewed" {
		t.Fatalf("after viewing: %+v", got)
	}
	if unknown := do(t, "POST", f.url+"/api/recent?path=code/repo/nope.md", "", nil); unknown.StatusCode != 404 {
		t.Fatalf("unknown file got %d", unknown.StatusCode)
	}
}

// A document changed on disk, in place or by renaming a temp file over it,
// is announced to the client, and revalidating with the old etag returns
// the new content.
func TestNeverStale(t *testing.T) {
	f := setup(t)
	path := filepath.Join(f.root, "repo", "plan.md")
	stream := do(t, "GET", f.url+"/api/events", "", nil)
	lines := bufio.NewScanner(stream.Body)

	changes := []func(content string){
		func(content string) { write(t, path, content) },
		func(content string) {
			tmp := path + ".tmp"
			write(t, tmp, content)
			os.Rename(tmp, path)
		},
	}
	for i, change := range changes {
		etag := do(t, "GET", f.url+"/api/file?path=code/repo/plan.md", "", nil).Header.Get("ETag")
		content := "changed " + string(rune('a'+i))

		change(content)

		expectEvent(t, lines, `{"kind":"changed","path":"code/repo/plan.md"}`)
		res := do(t, "GET", f.url+"/api/file?path=code/repo/plan.md", "", map[string]string{"If-None-Match": etag})
		if res.StatusCode != 200 || bodyOf(res) != content {
			t.Fatalf("change %d: got %d", i, res.StatusCode)
		}
	}
}

func expectEvent(t *testing.T, lines *bufio.Scanner, want string) {
	t.Helper()
	found := make(chan bool)
	go func() {
		for lines.Scan() {
			if lines.Text() == "data: "+want {
				found <- true
				return
			}
		}
		found <- false
	}()
	select {
	case ok := <-found:
		if !ok {
			t.Fatalf("stream ended before %s", want)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("no event %s", want)
	}
}
