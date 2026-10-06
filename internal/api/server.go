// Package api serves the markdown files, their change events and the web app
// over HTTP.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"

	"margin/internal/events"
	"margin/internal/files"
	"margin/internal/index"
	"margin/internal/recent"
	"margin/internal/seen"
	"margin/internal/workspace"
	"margin/internal/worktree"
)

const (
	maxFileSize  = 10 << 20
	pingInterval = 20 * time.Second
)

// Paths in the API are workspace paths: the root name, then the path within
// that root, as in code/gaius/plan.md.
type Server struct {
	Workspaces *workspace.Manager
	Recent     *recent.Store
	Seen       *seen.Store
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
	mux.HandleFunc("GET /api/seen", s.readSeen)
	mux.HandleFunc("PUT /api/seen", s.markSeen)
	mux.HandleFunc("GET /api/committed", s.readCommitted)
	mux.HandleFunc("GET /api/unread", s.unread)
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
	Path     string     `json:"path"`
	Repo     string     `json:"repo"`
	Project  string     `json:"project"`
	Main     bool       `json:"main"`               // the repo is its project's main checkout
	Git      bool       `json:"git"`                // the repo is a git checkout
	Changed  *time.Time `json:"changed,omitempty"`  // when the repo changed the file relative to main
	Modified *time.Time `json:"modified,omitempty"` // when the file was last modified, see modified
	Viewed   *time.Time `json:"viewed,omitempty"`   // when the file was last viewed in margin
}

func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	entries := []treeEntry{}
	for _, root := range s.Workspaces.Workspace().Roots() {
		for _, f := range root.Index.Files() {
			e := treeEntry{
				Path:    root.Join(f.Path),
				Repo:    root.Join(f.Repo),
				Project: root.Join(root.Trees.Project(f.Repo)),
				Main:    root.Trees.IsMain(f.Repo),
				Git:     root.Trees.IsGit(f.Repo),
			}
			if at, ok := root.Trees.Changed(f.Repo, inRepo(f)); ok {
				e.Changed = &at
			}
			if at, ok := modified(root, f); ok {
				e.Modified = &at
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
	writeMarkdown(w, doc.Content)
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
	if err := s.Seen.Advance(r.URL.Query().Get("path"), unquote(ifMatch), content); err != nil {
		log.Printf("seen: %v", err)
	}
	w.Header().Set("ETag", quote(etag))
	w.WriteHeader(http.StatusNoContent)
}

// readSeen returns the version of a file last read in margin.
func (s *Server) readSeen(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if !s.Workspaces.Workspace().Has(path) {
		writeError(w, files.ErrNotFound)
		return
	}
	content, ok, err := s.Seen.Get(path)
	if err != nil {
		writeError(w, err)
		return
	}
	if !ok {
		writeError(w, files.ErrNotFound)
		return
	}
	writeMarkdown(w, content)
}

// markSeen records the file's content as read, if it is still the version
// with the If-Match etag: the one the reader has seen.
func (s *Server) markSeen(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	store, rel, err := s.file(path)
	if err != nil {
		writeError(w, err)
		return
	}
	doc, err := store.Read(rel)
	if err != nil {
		writeError(w, err)
		return
	}
	if quote(doc.ETag) != r.Header.Get("If-Match") {
		writeError(w, files.ErrConflict)
		return
	}
	if err := s.Seen.Put(path, doc.Content); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// unread lists the files changed since they were last read.
func (s *Server) unread(w http.ResponseWriter, r *http.Request) {
	paths := []string{}
	for _, root := range s.Workspaces.Workspace().Roots() {
		for _, f := range root.Index.Files() {
			path := root.Join(f.Path)
			unread, err := s.Seen.Unread(path, f.ModTime, func() ([]byte, error) {
				doc, err := root.Files.Read(f.Path)
				return doc.Content, err
			})
			if err != nil && !errors.Is(err, files.ErrNotFound) {
				log.Printf("unread %s: %v", path, err)
			}
			if unread {
				paths = append(paths, path)
			}
		}
	}
	writeJSON(w, paths)
}

// readCommitted returns a file as committed in its repository's HEAD.
func (s *Server) readCommitted(w http.ResponseWriter, r *http.Request) {
	store, rel, err := s.file(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, err)
		return
	}
	abs, err := store.Abs(rel)
	if err != nil {
		writeError(w, err)
		return
	}
	content, ok := worktree.Committed(abs)
	if !ok {
		writeError(w, files.ErrNotFound)
		return
	}
	writeMarkdown(w, content)
}

type activity struct {
	Path string    `json:"path"`
	At   time.Time `json:"at"`
	Kind string    `json:"kind"` // "viewed" or "modified", whichever was last
}

// recent lists the files viewed in margin or modified within the active
// window, most recent first.
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
	writeJSON(w, all)
}

// modified reports when a file was last modified by someone working on it.
// In a git checkout only the changes git reports count, uncommitted or made
// on the worktree's branch: checkouts, rebases and pulls rewrite files that
// nobody edited. Outside git, the modification time is all there is.
func modified(root *workspace.Root, f index.File) (time.Time, bool) {
	if !root.Trees.IsGit(f.Repo) {
		return f.ModTime, true
	}
	return root.Trees.Changed(f.Repo, inRepo(f))
}

// addRecent records a view of a file. A file viewed for the first time has
// its version recorded as read, so changes show from then on.
func (s *Server) addRecent(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	store, rel, err := s.file(path)
	if err != nil || !s.Workspaces.Workspace().Has(path) {
		http.Error(w, "unknown file", http.StatusNotFound)
		return
	}
	if err := s.Recent.Add(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	err = s.Seen.Seed(path, func() ([]byte, error) {
		doc, err := store.Read(rel)
		return doc.Content, err
	})
	if err != nil {
		writeError(w, err)
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

func writeMarkdown(w http.ResponseWriter, content []byte) {
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(content)
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
