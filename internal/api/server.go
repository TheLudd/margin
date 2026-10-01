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
)

const (
	recentLimit  = 8
	maxFileSize  = 10 << 20
	pingInterval = 20 * time.Second
)

// TreeChanged is published when file metadata other than content changes,
// such as which worktree changed a file. Clients refetch the tree.
const TreeChanged index.Kind = "tree"

// Worktrees tells how repositories relate as git worktrees.
type Worktrees interface {
	Project(repo string) string
	IsMain(repo string) bool
	Changed(repo, rel string) (time.Time, bool)
}

type Server struct {
	Index     *index.Index
	Files     *files.Store
	Recent    *recent.Store
	Events    *events.Hub[index.Event]
	Worktrees Worktrees
	Web       fs.FS // the built frontend: index.html and assets/
	Port      int
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tree", s.tree)
	mux.HandleFunc("GET /api/file", s.readFile)
	mux.HandleFunc("PUT /api/file", s.writeFile)
	mux.HandleFunc("GET /api/recent", s.recent)
	mux.HandleFunc("POST /api/recent", s.addRecent)
	mux.HandleFunc("GET /api/events", s.events)
	mux.Handle("GET /assets/", http.FileServerFS(s.Web))
	mux.HandleFunc("GET /", s.app)
	return guard(s.Port, mux)
}

type treeEntry struct {
	index.File
	Project string     `json:"project"`
	Main    bool       `json:"main"`              // the repo is its project's main checkout
	Changed *time.Time `json:"changed,omitempty"` // when the repo changed the file relative to main
	Viewed  *time.Time `json:"viewed,omitempty"`  // when the file was last viewed in margin
}

func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	files := s.Index.Files()
	entries := make([]treeEntry, len(files))
	for i, f := range files {
		entries[i] = treeEntry{File: f, Project: f.Repo, Main: true}
		if at, ok := s.Recent.Viewed(f.Path); ok {
			entries[i].Viewed = &at
		}
		if s.Worktrees == nil {
			continue
		}
		entries[i].Project = s.Worktrees.Project(f.Repo)
		entries[i].Main = s.Worktrees.IsMain(f.Repo)
		if at, ok := s.Worktrees.Changed(f.Repo, strings.TrimPrefix(f.Path, f.Repo+"/")); ok {
			entries[i].Changed = &at
		}
	}
	writeJSON(w, entries)
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) {
	doc, err := s.Files.Read(r.URL.Query().Get("path"))
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
	etag, err := s.Files.Write(r.URL.Query().Get("path"), content, unquote(ifMatch))
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

// recent lists the files most recently viewed in margin or modified, most
// recent first.
func (s *Server) recent(w http.ResponseWriter, r *http.Request) {
	var all []activity
	for _, f := range s.Index.Files() {
		latest := activity{Path: f.Path}
		if at, ok := s.modified(f); ok {
			latest.At, latest.Kind = at, "modified"
		}
		if at, ok := s.Recent.Viewed(f.Path); ok && at.After(latest.At) {
			latest.At, latest.Kind = at, "viewed"
		}
		if latest.Kind != "" {
			all = append(all, latest)
		}
	}
	slices.SortFunc(all, func(a, b activity) int { return b.At.Compare(a.At) })
	writeJSON(w, all[:min(recentLimit, len(all))])
}

// modified reports when a file was last modified. A worktree's own copy
// counts only when git says the worktree changed it, because checkouts
// reset modification times.
func (s *Server) modified(f index.File) (time.Time, bool) {
	if s.Worktrees == nil || s.Worktrees.IsMain(f.Repo) {
		return f.ModTime, true
	}
	return s.Worktrees.Changed(f.Repo, strings.TrimPrefix(f.Path, f.Repo+"/"))
}

func (s *Server) addRecent(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if !s.Index.Has(path) {
		http.Error(w, "unknown file", http.StatusNotFound)
		return
	}
	if err := s.Recent.Add(path); err != nil {
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

// app serves the single-page app for the root and for any markdown path.
func (s *Server) app(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && !strings.HasSuffix(strings.ToLower(r.URL.Path), ".md") {
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
