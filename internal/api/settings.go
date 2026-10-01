package api

import (
	"encoding/json"
	"net/http"

	"margin/internal/config"
)

const suggestionLimit = 20

type rootSettings struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Files int    `json:"files"`
}

type settingsResponse struct {
	File  string         `json:"file"`            // where the config is stored
	Roots []rootSettings `json:"roots"`           // the roots in use
	Error string         `json:"error,omitempty"` // why the config file could not be used
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.currentSettings())
}

func (s *Server) currentSettings() settingsResponse {
	c, err := s.Workspaces.Config()
	files := map[string]int{}
	for _, root := range s.Workspaces.Workspace().Roots() {
		files[root.Name] = len(root.Index.Files())
	}
	res := settingsResponse{File: config.Abbreviate(s.Workspaces.File()), Roots: []rootSettings{}}
	for _, root := range c.Roots {
		res.Roots = append(res.Roots, rootSettings{Name: root.Name, Path: root.Path, Files: files[root.Name]})
	}
	if err != nil {
		res.Error = err.Error()
	}
	return res
}

// saveSettings replaces the roots. An invalid config is rejected with the
// reason, and nothing changes.
func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	var c config.Config
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&c); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.Workspaces.Apply(c); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, s.currentSettings())
}

// dirs suggests folders completing a partly typed path.
func (s *Server) dirs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, config.SuggestDirs(r.URL.Query().Get("path"), suggestionLimit))
}
