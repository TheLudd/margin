package guard

import "testing"

func TestGuard(t *testing.T) {
	g := New("box", []string{"192.168.1.5", "fe80::1"}, []string{"margin.local"})

	t.Run("P-06: localhost, loopback, hostname, interface addresses and -host names are accepted", func(t *testing.T) {
		for _, h := range []string{"localhost", "localhost:48217", "127.0.0.1:48217", "[::1]:48217", "box", "BOX:48217", "192.168.1.5:48217", "[fe80::1]:48217", "margin.local", "margin.local:80"} {
			if !g.AllowHost(h) {
				t.Errorf("%q should be allowed", h)
			}
		}
	})
	t.Run("P-06: any other host is refused", func(t *testing.T) {
		for _, h := range []string{"", "evil.example", "localhost.evil.example", "127.0.0.2", "box.evil"} {
			if g.AllowHost(h) {
				t.Errorf("%q should be refused", h)
			}
		}
	})
	t.Run("P-06: an Origin must match the Host when present", func(t *testing.T) {
		if ok, _ := g.Allow("localhost:48217", "http://localhost:48217"); !ok {
			t.Error("matching origin refused")
		}
		if ok, _ := g.Allow("localhost:48217", ""); !ok {
			t.Error("absent origin refused")
		}
		if ok, why := g.Allow("localhost:48217", "http://evil.example"); ok || why == "" {
			t.Error("foreign origin accepted")
		}
		if ok, _ := g.Allow("localhost:48217", "null"); ok {
			t.Error("null origin accepted")
		}
		if ok, _ := g.Allow("margin.local", "https://margin.local"); !ok {
			t.Error("origin behind a TLS proxy refused")
		}
	})
	t.Run("P-04: -host adds a name margin accepts", func(t *testing.T) {
		if New("box", nil, nil).AllowHost("margin.local") {
			t.Error("name accepted without -host")
		}
		if !New("box", nil, []string{"margin.local"}).AllowHost("margin.local") {
			t.Error("name refused with -host")
		}
	})
}
