// Package server is margin's HTTP layer: the API, the event stream and the
// embedded frontend, every request checked by the guard (P-06).
package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"margin/internal/config"
	"margin/internal/core"
	"margin/internal/guard"
)

// Ping is how often a comment keeps the event stream alive through proxies.
var Ping = 25 * time.Second

// Server serves margin.
type Server struct {
	core   *core.Core
	guard  *guard.Guard
	static fs.FS
	mux    *http.ServeMux
}

// New builds the handler. static holds index.html and assets/.
func New(c *core.Core, g *guard.Guard, static fs.FS) *Server {
	s := &Server{core: c, guard: g, static: static, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /api/lists", s.lists)
	s.mux.HandleFunc("GET /api/file/{path...}", s.readFile)
	s.mux.HandleFunc("PUT /api/file/{path...}", s.writeFile)
	s.mux.HandleFunc("GET /api/baseline/{path...}", s.baseline)
	s.mux.HandleFunc("POST /api/open", s.open)
	s.mux.HandleFunc("POST /api/read", s.markRead)
	s.mux.HandleFunc("POST /api/manual", s.manual)
	s.mux.HandleFunc("POST /api/dismiss", s.dismiss)
	s.mux.HandleFunc("GET /api/settings", s.settings)
	s.mux.HandleFunc("PUT /api/settings", s.saveSettings)
	s.mux.HandleFunc("GET /api/suggest", s.suggest)
	s.mux.HandleFunc("GET /api/complete", s.complete)
	s.mux.HandleFunc("GET /api/events", s.events)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, http.StatusNotFound, "no such endpoint") })
	s.mux.HandleFunc("/", s.page)
	return s
}

// ServeHTTP checks the guard, then routes.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if ok, why := s.guard.Allow(r.Host, r.Header.Get("Origin")); !ok {
		http.Error(w, "forbidden: "+why, http.StatusForbidden)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func fail(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(v)
}

func failErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, core.ErrNotFound), errors.Is(err, core.ErrNoCopy):
		fail(w, http.StatusNotFound, err.Error())
	case errors.Is(err, core.ErrOutside):
		fail(w, http.StatusForbidden, err.Error())
	case errors.Is(err, core.ErrMismatch):
		fail(w, http.StatusPreconditionFailed, err.Error())
	default:
		fail(w, http.StatusInternalServerError, err.Error())
	}
}

func (s *Server) lists(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.core.Lists())
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) {
	doc, err := s.core.Read("/" + r.PathValue("path"))
	if err != nil {
		failErr(w, err)
		return
	}
	w.Header().Set("ETag", doc.Etag)
	w.Header().Set("Cache-Control", "no-cache")
	if match := r.Header.Get("If-None-Match"); match != "" && match == doc.Etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, doc)
}

func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) {
	ifMatch := r.Header.Get("If-Match")
	if ifMatch == "" {
		fail(w, http.StatusPreconditionRequired, "If-Match required")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<20))
	if err != nil {
		fail(w, http.StatusBadRequest, "body unreadable")
		return
	}
	etag, err := s.core.Write("/"+r.PathValue("path"), body, ifMatch)
	if err != nil {
		failErr(w, err)
		return
	}
	w.Header().Set("ETag", etag)
	writeJSON(w, map[string]string{"etag": etag})
}

func (s *Server) baseline(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind == "" {
		kind = "read"
	}
	data, err := s.core.Baseline("/"+r.PathValue("path"), kind)
	if err != nil {
		failErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
}

type pathBody struct {
	Path   string `json:"path"`
	Manual bool   `json:"manual"`
}

func readBody(w http.ResponseWriter, r *http.Request) (pathBody, bool) {
	var b pathBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b); err != nil || b.Path == "" {
		fail(w, http.StatusBadRequest, "path required")
		return b, false
	}
	return b, true
}

func (s *Server) open(w http.ResponseWriter, r *http.Request) {
	b, ok := readBody(w, r)
	if !ok {
		return
	}
	if err := s.core.Open(b.Path); err != nil {
		failErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) markRead(w http.ResponseWriter, r *http.Request) {
	b, ok := readBody(w, r)
	if !ok {
		return
	}
	if err := s.core.MarkRead(b.Path); err != nil {
		failErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) manual(w http.ResponseWriter, r *http.Request) {
	b, ok := readBody(w, r)
	if !ok {
		return
	}
	if err := s.core.SetManual(b.Path, b.Manual); err != nil {
		failErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true, "manual": b.Manual})
}

func (s *Server) dismiss(w http.ResponseWriter, r *http.Request) {
	b, ok := readBody(w, r)
	if !ok {
		return
	}
	if err := s.core.Dismiss(b.Path); err != nil {
		failErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.core.Settings())
}

func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	var cfg config.Config
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&cfg); err != nil {
		fail(w, http.StatusBadRequest, "settings unreadable: "+err.Error())
		return
	}
	reindexed, err := s.core.SaveSettings(cfg)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"reindexed": reindexed})
}

func (s *Server) suggest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.core.Suggest())
}

func (s *Server) complete(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.core.Complete(r.URL.Query().Get("q")))
}

// events is the stream (P-09, N-01, N-05): the build id first, then every
// event, with a comment now and then to keep proxies from closing it.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "event: build\ndata: %s\n\n", s.core.Build())
	flusher.Flush()
	ch, stop := s.core.Hub().Subscribe()
	defer stop()
	ping := time.NewTicker(Ping)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(ev.Data)
			if ev.Data == nil {
				data = []byte("{}")
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, data)
			flusher.Flush()
		}
	}
}

// page serves the frontend: hashed assets for a year, everything else the
// app page, which routes on the path.
func (s *Server) page(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if strings.HasPrefix(p, "assets/") {
		if data, err := fs.ReadFile(s.static, p); err == nil {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			w.Header().Set("Content-Type", contentType(p))
			w.Write(data)
			return
		}
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(s.static, "index.html")
	if err != nil {
		http.Error(w, "frontend missing", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
}

func contentType(p string) string {
	switch path.Ext(p) {
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".woff2":
		return "font/woff2"
	case ".json":
		return "application/json"
	}
	return "application/octet-stream"
}
