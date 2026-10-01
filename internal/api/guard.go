package api

import (
	"fmt"
	"net/http"
	"strings"
)

// guard rejects requests that don't come from margin's own pages: a foreign
// Host header (DNS rebinding) or a foreign Origin (another site in the
// browser calling the local service). Besides localhost, hosts lists other
// names margin is reached by, accepted with or without the port so a reverse
// proxy on port 80 works.
func guard(port int, hosts []string, next http.Handler) http.Handler {
	allowed := map[string]bool{
		fmt.Sprintf("localhost:%d", port): true,
		fmt.Sprintf("127.0.0.1:%d", port): true,
	}
	for _, host := range hosts {
		allowed[host] = true
		allowed[fmt.Sprintf("%s:%d", host, port)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowed[r.Host] {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !allowed[strings.TrimPrefix(origin, "http://")] {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		// Following a link to margin from another site is fine; scripts are not.
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" && r.Header.Get("Sec-Fetch-Mode") != "navigate" {
			http.Error(w, "forbidden cross-site request", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
