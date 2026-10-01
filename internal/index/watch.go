package index

import (
	"context"
	"log"
	"os"

	"github.com/fsnotify/fsnotify"
)

// Run applies filesystem changes to the index and emits an event for every
// markdown file added, changed or removed, until ctx is done.
//
// Directories are watched rather than files, so a file replaced by renaming
// a temp file over it is still seen as changed.
func (ix *Index) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ix.watcher.Events:
			if !ok {
				return
			}
			ix.handle(ev)
		case err, ok := <-ix.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("watcher: %v", err)
		}
	}
}

func (ix *Index) handle(ev fsnotify.Event) {
	rel := ix.rel(ev.Name)
	switch {
	case ev.Has(fsnotify.Create) || ev.Has(fsnotify.Write):
		ix.update(ev.Name, rel)
	case ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename):
		ix.emitAll(Removed, ix.removeTree(rel))
	}
}

func (ix *Index) update(abs, rel string) {
	info, err := os.Stat(abs)
	if err != nil {
		return // already gone; its remove event follows
	}
	if info.IsDir() {
		if !ix.dirs[abs] && !ix.skipDir(rel, info.Name()) {
			ix.emitAll(Added, ix.addTree(abs))
		}
		return
	}
	if !isMarkdown(abs) || ix.ignore.ignored(rel, false) {
		return
	}
	if ix.put(abs, rel) {
		ix.emit(Event{Kind: Added, Path: rel})
	} else {
		ix.emit(Event{Kind: Changed, Path: rel})
	}
}

func (ix *Index) emitAll(kind Kind, paths []string) {
	for _, p := range paths {
		ix.emit(Event{Kind: kind, Path: p})
	}
}
