// margin serves the markdown files in the configured folders for reading and
// editing in the browser.
package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"margin/internal/api"
	"margin/internal/config"
	"margin/internal/events"
	"margin/internal/index"
	"margin/internal/recent"
	"margin/internal/seen"
	"margin/internal/workspace"
	"margin/web"
)

const defaultPort = 48217

func main() {
	configFile := flag.String("config", config.File(), "config file listing the folders to serve")
	port := flag.Int("port", defaultPort, "port to listen on (127.0.0.1 only)")
	state := flag.String("state", config.StateDir(), "directory for margin's own state")
	var hosts []string
	flag.Func("host", "another name margin is reached by, such as margin.local behind a reverse proxy (repeatable)", func(host string) error {
		hosts = append(hosts, host)
		return nil
	})
	flag.Parse()

	if err := run(*configFile, *port, *state, hosts); err != nil {
		log.Fatal(err)
	}
}

func run(configFile string, port int, state string, hosts []string) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	hub := events.NewHub[index.Event]()
	// Views are kept as long as the longest active window allows.
	viewed, err := recent.Load(filepath.Join(state, "recent.json"), config.MaxActiveDays*24*time.Hour)
	if err != nil {
		return err
	}
	workspaces := workspace.NewManager(configFile, hub.Publish, func(ws *workspace.Workspace) { migrateViews(viewed, ws) })
	defer workspaces.Close()
	go workspaces.Watch(ctx)
	read, err := seen.Open(filepath.Join(state, "seen"))
	if err != nil {
		return err
	}
	tracker := &seen.Tracker{
		Store:     read,
		Workspace: workspaces.Workspace,
		Keep: func() time.Duration {
			c, _ := workspaces.Config()
			return time.Duration(c.Unread()) * 24 * time.Hour
		},
	}
	go tracker.Run(ctx, hub.Subscribe)

	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		Handler: (&api.Server{
			Workspaces: workspaces,
			Recent:     viewed,
			Seen:       read,
			Events:     hub,
			Web:        dist,
			Port:       port,
			Hosts:      hosts,
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

// migrateViews moves views recorded before paths started with a root name
// to the root that has the file.
func migrateViews(viewed *recent.Store, ws *workspace.Workspace) {
	err := viewed.Rename(func(path string) (string, bool) {
		if ws.Has(path) {
			return "", false
		}
		return ws.Locate(path)
	})
	if err != nil {
		log.Printf("views: %v", err)
	}
}
