package seen

import (
	"context"
	"errors"
	"log"
	"time"

	"margin/internal/files"
	"margin/internal/index"
	"margin/internal/workspace"
)

const sweepInterval = 24 * time.Hour

// Tracker records the first version of every file in the workspace as read
// and forgets versions read too long ago.
type Tracker struct {
	Store     *Store
	Workspace func() *workspace.Workspace
	Keep      func() time.Duration // how long a version read is kept
}

// Run tracks the files indexed now and index events until ctx is done,
// sweeping old versions away daily. subscribe is called again whenever the
// event stream ends.
func (t *Tracker) Run(ctx context.Context, subscribe func() (<-chan index.Event, func())) {
	for ctx.Err() == nil {
		events, unsubscribe := subscribe()
		t.sweep() // after subscribing, so no file is missed
		t.follow(ctx, events)
		unsubscribe()
	}
}

func (t *Tracker) follow(ctx context.Context, events <-chan index.Event) {
	daily := time.NewTicker(sweepInterval)
	defer daily.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			switch ev.Kind {
			case index.Added, index.Changed:
				seed(t.Store, t.Workspace(), ev.Path)
			case workspace.TreeChanged: // roots or settings may have changed
				t.sweep()
			}
		case <-daily.C:
			t.sweep()
		}
	}
}

// sweep forgets old versions, then records the files without one, so a
// file not read for a long time starts over from its current version.
func (t *Tracker) sweep() {
	if err := t.Store.Prune(t.Keep()); err != nil {
		log.Printf("seen: %v", err)
	}
	ws := t.Workspace()
	for _, root := range ws.Roots() {
		for _, f := range root.Index.Files() {
			seed(t.Store, ws, root.Join(f.Path))
		}
	}
}

func seed(s *Store, ws *workspace.Workspace, path string) {
	root, rel, ok := ws.Resolve(path)
	if !ok {
		return
	}
	err := s.Seed(path, func() ([]byte, error) {
		doc, err := root.Files.Read(rel)
		return doc.Content, err
	})
	if err != nil && !errors.Is(err, files.ErrNotFound) {
		log.Printf("seen %s: %v", path, err)
	}
}
