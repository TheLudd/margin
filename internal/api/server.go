// Package api serves the markdown files, their change events and the web app
// over HTTP.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"slices"
	"strings"
	"time"

	"margin/internal/events"
	"margin/internal/files"
	"margin/internal/index"
	"margin/internal/recent"
	"margin/internal/workspace"
)

const (
	recentLimit  = 8
	maxFileSize  = 10 << 20
	pingInterval = 20 * time.Second
)

// Paths in the API are workspace paths: the root name, then the path within
// that root, as in code/gaius/plan.md.
type Server struct {
	Workspaces *workspace.Manager
	Recent     *recent.Store
	Events     *events.Hub[index.Event]
	Web        fs.FS // the built frontend: index.html and assets/
	Port       int
	Hosts      []string // other names margin is reached by, such as margin.local
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tree", s.tree)
	mux.HandleFunc("GET /api/file", s.readFile)
	mux.HandleFunc("PUT /api/file", s.writeFile)
	mux.HandleFunc("GET /api/recent", s.recent)
	mux.HandleFunc("POST /api/recent", s.addRecent)
	mux.HandleFunc("DELETE /api/recent", s.forgetRecent)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/settings", s.settings)
	mux.HandleFunc("PUT /api/settings", s.saveSettings)
	mux.HandleFunc("GET /api/dirs", s.dirs)
	mux.HandleFunc("GET /api/home-folders", s.homeFolders)
	mux.Handle("GET /assets/", http.FileServerFS(s.Web))
	mux.HandleFunc("GET /", s.app)
	return guard(s.Port, s.Hosts, mux)
}

type treeEntry struct {
	Path    string     `json:"path"`
	Repo    string     `json:"repo"`
	ModTime time.Time  `json:"mtime"`
	Project string     `json:"project"`
	Main    bool       `json:"main"`              // the repo is its project's main checkout
	Changed *time.Time `json:"changed,omitempty"` // when the repo changed the file relative to main
	Viewed  *time.Time `json:"viewed,omitempty"`  // when the file was last viewed in margin
}

func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	entries := []treeEntry{}
	for _, root := range s.Workspaces.Workspace().Roots() {
		for _, f := range root.Index.Files() {
			e := treeEntry{
				Path:    root.Join(f.Path),
				Repo:    root.Join(f.Repo),
				ModTime: f.ModTime,
				Project: root.Join(root.Trees.Project(f.Repo)),
				Main:    root.Trees.IsMain(f.Repo),
			}
			if at, ok := root.Trees.Changed(f.Repo, inRepo(f)); ok {
				e.Changed = &at
			}
			if at, ok := s.Recent.Viewed(e.Path); ok {
				e.Viewed = &at
			}
			entries = append(entries, e)
		}
	}
	writeJSON(w, entries)
}

func inRepo(f index.File) string {
	if f.Repo == "" {
		return f.Path
	}
	return strings.TrimPrefix(f.Path, f.Repo+"/")
}

// file resolves a workspace path to its root's file store and the path in it.
func (s *Server) file(path string) (*files.Store, string, error) {
	root, rel, ok := s.Workspaces.Workspace().Resolve(path)
	if !ok {
		return nil, "", files.ErrNotFound
	}
	return root.Files, rel, nil
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) {
	store, rel, err := s.file(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, err)
		return
	}
	doc, err := store.Read(rel)
	if err != nil {
		writeError(w, err)
		return
	}
	etag := quote(doc.ETag)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Write(doc.Content)
}

func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) {
	ifMatch := r.Header.Get("If-Match")
	if ifMatch == "" {
		http.Error(w, "If-Match is required", http.StatusPreconditionRequired)
		return
	}
	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxFileSize))
	if err != nil {
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
		return
	}
	store, rel, err := s.file(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, err)
		return
	}
	etag, err := store.Write(rel, content, unquote(ifMatch))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("ETag", quote(etag))
	w.WriteHeader(http.StatusNoContent)
}

type activity struct {
	Path string    `json:"path"`
	At   time.Time `json:"at"`
	Kind string    `json:"kind"` // "viewed" or "modified", whichever was last
}

// recent lists the files most recently viewed in margin or modified within
// the active window, most recent first.
func (s *Server) recent(w http.ResponseWriter, r *http.Request) {
	c, _ := s.Workspaces.Config()
	since := time.Now().AddDate(0, 0, -c.Active())
	all := []activity{}
	for _, root := range s.Workspaces.Workspace().Roots() {
		for _, f := range root.Index.Files() {
			latest := activity{Path: root.Join(f.Path)}
			if at, ok := modified(root, f); ok {
				latest.At, latest.Kind = at, "modified"
			}
			if at, ok := s.Recent.Viewed(latest.Path); ok && at.After(latest.At) {
				latest.At, latest.Kind = at, "viewed"
			}
			if dismissed, ok := s.Recent.Dismissed(latest.Path); ok && !latest.At.After(dismissed) {
				continue
			}
			if latest.Kind != "" && latest.At.After(since) {
				all = append(all, latest)
			}
		}
	}
	slices.SortFunc(all, func(a, b activity) int { return b.At.Compare(a.At) })
	writeJSON(w, all[:min(recentLimit, len(all))])
}

// modified reports when a file was last modified. A worktree's own copy
// counts only when git says the worktree changed it, because checkouts
// reset modification times.
func modified(root *workspace.Root, f index.File) (time.Time, bool) {
	if root.Trees.IsMain(f.Repo) {
		return f.ModTime, true
	}
	return root.Trees.Changed(f.Repo, inRepo(f))
}

func (s *Server) addRecent(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if !s.Workspaces.Workspace().Has(path) {
		http.Error(w, "unknown file", http.StatusNotFound)
		return
	}
	if err := s.Recent.Add(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgetRecent removes a file from recent activity until it is viewed or
// changed again.
func (s *Server) forgetRecent(w http.ResponseWriter, r *http.Request) {
	if err := s.Recent.Forget(r.URL.Query().Get("path")); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// events streams index events as server-sent events. The stream ends when
// the client falls behind; the client then reconnects and revalidates.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	ch, unsubscribe := s.Events.Subscribe()
	defer unsubscribe()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	rc := http.NewResponseController(w)
	fmt.Fprint(w, "retry: 1000\n\n")
	rc.Flush()

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(ev)
			fmt.Fprintf(w, "data: %s\n\n", data)
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
		}
		if err := rc.Flush(); err != nil {
			return
		}
	}
}

// app serves the single-page app for the root, the settings and any
// markdown path.
func (s *Server) app(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/settings" && !strings.HasSuffix(strings.ToLower(r.URL.Path), ".md") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, s.Web, "index.html")
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, files.ErrNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, files.ErrOutsideRoot):
		http.Error(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, files.ErrNotMarkdown):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, files.ErrConflict):
		http.Error(w, err.Error(), http.StatusPreconditionFailed)
	default:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func quote(etag string) string { return `"` + etag + `"` }

func unquote(etag string) string { return strings.Trim(etag, `"`) }
