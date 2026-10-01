// margin serves the markdown files under ~/code for reading and editing in
// the browser.
package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"margin/internal/api"
	"margin/internal/events"
	"margin/internal/files"
	"margin/internal/index"
	"margin/internal/recent"
	"margin/internal/worktree"
	"margin/web"
)

const defaultPort = 48217

func main() {
	home, _ := os.UserHomeDir()
	root := flag.String("root", filepath.Join(home, "code"), "directory to serve")
	port := flag.Int("port", defaultPort, "port to listen on (127.0.0.1 only)")
	state := flag.String("state", stateDir(home), "directory for margin's own state")
	flag.Parse()

	if err := run(*root, *port, *state); err != nil {
		log.Fatal(err)
	}
}

func run(root string, port int, state string) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	hub := events.NewHub[index.Event]()
	started := time.Now()
	ix, err := index.New(root, hub.Publish)
	if err != nil {
		return err
	}
	defer ix.Close()
	go ix.Run(ctx)

	trees := worktree.New(root, ix.Files, func() { hub.Publish(index.Event{Kind: api.TreeChanged}) })
	trees.Refresh()
	log.Printf("indexed %d files under %s in %s", len(ix.Files()), root, time.Since(started).Round(time.Millisecond))
	go trees.Run(ctx, hub.Subscribe)

	store, err := files.New(root)
	if err != nil {
		return err
	}
	viewed, err := recent.Load(filepath.Join(state, "recent.json"), 5)
	if err != nil {
		return err
	}
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		Handler: (&api.Server{
			Index:     ix,
			Files:     store,
			Recent:    viewed,
			Events:    hub,
			Worktrees: trees,
			Web:       dist,
			Port:      port,
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Requests share ctx so open event streams end on shutdown.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Printf("listening on http://localhost:%d", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func stateDir(home string) string {
	if dir := os.Getenv("XDG_STATE_HOME"); dir != "" {
		return filepath.Join(dir, "margin")
	}
	return filepath.Join(home, ".local", "state", "margin")
}
