// Package guard checks that a request names margin (P-06): the Host header
// must be one of margin's names, and an Origin header, when present, must
// match the Host. This defeats DNS rebinding, where a page in the reader's own
// browser gets its domain pointed at margin's address.
package guard

import (
	"net"
	"net/url"
	"strings"
)

// Guard holds the names margin answers to.
type Guard struct {
	names map[string]bool
}

// New builds a guard that accepts localhost, the loopback addresses, the given
// hostname, the given interface addresses and any extra names.
func New(hostname string, addrs []string, extra []string) *Guard {
	g := &Guard{names: map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}}
	g.add(hostname)
	for _, a := range addrs {
		g.add(a)
	}
	for _, e := range extra {
		g.add(e)
	}
	return g
}

func (g *Guard) add(name string) {
	name = strings.ToLower(strings.TrimSpace(name))
	if name != "" {
		g.names[name] = true
	}
}

// Names lists the accepted names, for logging.
func (g *Guard) Names() []string {
	out := make([]string, 0, len(g.names))
	for n := range g.names {
		out = append(out, n)
	}
	return out
}

// AllowHost reports whether a Host header value names margin.
func (g *Guard) AllowHost(host string) bool {
	return g.names[hostOnly(host)]
}

// Allow reports whether a request with the given Host and Origin headers is
// accepted, and why not when it isn't.
func (g *Guard) Allow(host, origin string) (bool, string) {
	if !g.AllowHost(host) {
		return false, "host not known"
	}
	if origin == "" {
		return true, ""
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false, "origin unreadable"
	}
	if !strings.EqualFold(u.Host, host) {
		return false, "origin does not match host"
	}
	return true, ""
}

// hostOnly strips the port and IPv6 brackets from a Host header value.
func hostOnly(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.Trim(host, "[]")
}
