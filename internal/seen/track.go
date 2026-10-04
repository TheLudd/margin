package seen

import (
	"context"
	"errors"
	"log"

	"margin/internal/files"
	"margin/internal/index"
	"margin/internal/workspace"
)

// Track records the first version of every file in the workspace as read,
// from the files indexed now and from index events, until ctx is done.
// subscribe is called again whenever the event stream ends.
func Track(ctx context.Context, s *Store, current func() *workspace.Workspace, subscribe func() (<-chan index.Event, func())) {
	for ctx.Err() == nil {
		events, unsubscribe := subscribe()
		seedAll(s, current()) // after subscribing, so no file is missed
		follow(ctx, s, current, events)
		unsubscribe()
	}
}

func follow(ctx context.Context, s *Store, current func() *workspace.Workspace, events <-chan index.Event) {
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
				seed(s, current(), ev.Path)
			case workspace.TreeChanged: // roots may have been added
				seedAll(s, current())
			}
		}
	}
}

func seedAll(s *Store, ws *workspace.Workspace) {
	for _, root := range ws.Roots() {
		for _, f := range root.Index.Files() {
			seed(s, ws, root.Join(f.Path))
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
