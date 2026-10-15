// margin is a local, always-running service for reading the markdown files
// in a set of folders, in the browser. See spec.md.
package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"margin/internal/core"
	"margin/internal/guard"
	"margin/internal/paths"
	"margin/internal/server"
)

//go:embed all:web/dist
var dist embed.FS

type hosts []string

func (h *hosts) String() string     { return strings.Join(*h, ",") }
func (h *hosts) Set(v string) error { *h = append(*h, v); return nil }

func main() {
	var (
		port       = flag.Int("port", 48217, "port to listen on; 0 picks a free one")
		listen     = flag.String("listen", "127.0.0.1", "address to bind; an interface address or 0.0.0.0 opens margin to the LAN")
		configFlag = flag.String("config", "", "config file (default $XDG_CONFIG_HOME/margin/config.json)")
		stateFlag  = flag.String("state", "", "state folder (default $XDG_STATE_HOME/margin)")
		extra      hosts
	)
	flag.Var(&extra, "host", "another name margin accepts in the Host header (repeatable)")
	flag.Parse()

	home, err := os.UserHomeDir()
	if err != nil {
		fatal(err)
	}
	opts := core.Options{
		ConfigFile: paths.ConfigFile(*configFlag, os.Getenv, home),
		StateDir:   paths.StateDir(*stateFlag, os.Getenv, home),
		Home:       home,
		Build:      buildID(),
	}
	c, err := core.New(opts)
	if err != nil {
		fatal(err)
	}
	defer c.Close()

	hostname, _ := os.Hostname()
	g := guard.New(hostname, interfaceAddrs(), extra)
	static, err := fs.Sub(dist, "web/dist")
	if err != nil {
		fatal(err)
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(*listen, fmt.Sprint(*port)))
	if err != nil {
		fatal(err)
	}
	fmt.Fprintf(os.Stderr, "margin %s listening on http://%s (config %s, state %s)\n", opts.Build, ln.Addr(), opts.ConfigFile, opts.StateDir)
	srv := &http.Server{Handler: server.New(c, g, static), ReadHeaderTimeout: 10 * time.Second}
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "margin:", err)
	os.Exit(1)
}

// buildID identifies the running build (P-09): a hash of the executable, so
// every build gets a new one.
func buildID() string {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Sprint(time.Now().UnixNano())
	}
	f, err := os.Open(exe)
	if err != nil {
		return fmt.Sprint(time.Now().UnixNano())
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Sprint(time.Now().UnixNano())
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// interfaceAddrs lists the machine's addresses at startup (P-06).
func interfaceAddrs() []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok {
			out = append(out, ipn.IP.String())
		}
	}
	return out
}
