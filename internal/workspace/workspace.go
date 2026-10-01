// Package workspace serves several root directories as one tree. Every path
// starts with the name of its root: "code/gaius/plan.md" is gaius/plan.md
// under the root named code.
package workspace

import (
	"context"
	"log"
	"strings"
	"time"

	"margin/internal/config"
	"margin/internal/events"
	"margin/internal/files"
	"margin/internal/index"
	"margin/internal/worktree"
)

type Root struct {
	Name  string
	Path  string // as configured, possibly with ~
	Dir   string // resolved absolute directory
	Index *index.Index
	Files *files.Store
	Trees *worktree.Tracker
}

// Join returns the workspace path of rel under the root.
func (r *Root) Join(rel string) string {
	if rel == "" {
		return r.Name
	}
	return r.Name + "/" + rel
}

type Workspace struct {
	roots  []*Root
	byName map[string]*Root
	cancel context.CancelFunc
}

// Open indexes every root in cfg, which must be valid. Index events are
// passed to publish with workspace paths; treeChanged is called when
// worktree information changes.
func Open(cfg config.Config, publish func(index.Event), treeChanged func()) (*Workspace, error) {
	ctx, cancel := context.WithCancel(context.Background())
	w := &Workspace{byName: map[string]*Root{}, cancel: cancel}
	for _, rc := range cfg.Roots {
		root, err := openRoot(ctx, rc, publish, treeChanged)
		if err != nil {
			w.Close()
			return nil, err
		}
		w.roots = append(w.roots, root)
		w.byName[root.Name] = root
	}
	return w, nil
}

func openRoot(ctx context.Context, rc config.Root, publish func(index.Event), treeChanged func()) (*Root, error) {
	dir, err := config.Resolve(rc.Path)
	if err != nil {
		return nil, err
	}
	started := time.Now()
	root := &Root{Name: rc.Name, Path: rc.Path, Dir: dir}

	// The tracker follows this root's events with root-relative paths.
	local := events.NewHub[index.Event]()
	root.Index, err = index.New(dir, func(e index.Event) {
		local.Publish(e)
		publish(index.Event{Kind: e.Kind, Path: root.Join(e.Path)})
	})
	if err != nil {
		return nil, err
	}
	if root.Files, err = files.New(dir); err != nil {
		root.Index.Close()
		return nil, err
	}
	root.Trees = worktree.New(dir, root.Index.Files, treeChanged)
	root.Trees.Refresh()

	go root.Index.Run(ctx)
	go root.Trees.Run(ctx, local.Subscribe)
	log.Printf("%s: indexed %d files under %s in %s", root.Name, len(root.Index.Files()), dir, time.Since(started).Round(time.Millisecond))
	return root, nil
}

func (w *Workspace) Close() {
	w.cancel()
	for _, r := range w.roots {
		r.Index.Close()
	}
}

func (w *Workspace) Roots() []*Root {
	return w.roots
}

// Resolve splits a workspace path into its root and the path within it.
func (w *Workspace) Resolve(path string) (*Root, string, bool) {
	name, rel, _ := strings.Cut(path, "/")
	root, ok := w.byName[name]
	return root, rel, ok
}

// Has reports whether path is an indexed markdown file.
func (w *Workspace) Has(path string) bool {
	root, rel, ok := w.Resolve(path)
	return ok && root.Index.Has(rel)
}

// Locate finds a root-relative path from before roots were named, and
// returns its workspace path in the first root that has it.
func (w *Workspace) Locate(rel string) (string, bool) {
	for _, r := range w.roots {
		if r.Index.Has(rel) {
			return r.Join(rel), true
		}
	}
	return "", false
}
