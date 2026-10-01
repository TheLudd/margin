package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func settingsOf(t *testing.T, res *http.Response) settingsResponse {
	t.Helper()
	var got settingsResponse
	json.NewDecoder(res.Body).Decode(&got)
	return got
}

func TestSettings(t *testing.T) {
	f := setup(t)

	got := settingsOf(t, do(t, "GET", f.url+"/api/settings", "", nil))

	if len(got.Roots) != 1 || got.Roots[0].Name != "code" || got.Roots[0].Files != 1 || got.ActiveDays != 14 || got.Error != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestSaveSettingsAddsRoot(t *testing.T) {
	f := setup(t)
	notes := t.TempDir()
	write(t, filepath.Join(notes, "ideas.md"), "ideas")
	body := `{"roots":[{"name":"code","path":"` + f.root + `"},{"name":"notes","path":"` + notes + `"}]}`

	res := do(t, "PUT", f.url+"/api/settings", body, nil)

	if res.StatusCode != 200 || len(settingsOf(t, res).Roots) != 2 {
		t.Fatalf("got %d", res.StatusCode)
	}
	if do(t, "GET", f.url+"/api/file?path=notes/ideas.md", "", nil).StatusCode != 200 {
		t.Fatal("new root not served")
	}
}

func TestSaveSettingsRejectsInvalid(t *testing.T) {
	f := setup(t)

	res := do(t, "PUT", f.url+"/api/settings", `{"roots":[{"name":"x","path":"/does/not/exist"}]}`, nil)

	if res.StatusCode != 400 || !strings.Contains(bodyOf(res), "no such folder") {
		t.Fatalf("got %d", res.StatusCode)
	}
	if do(t, "GET", f.url+"/api/file?path=code/repo/plan.md", "", nil).StatusCode != 200 {
		t.Fatal("rejected config changed what is served")
	}
}

func TestSaveSettingsRequiresOwnOrigin(t *testing.T) {
	f := setup(t)

	res := do(t, "PUT", f.url+"/api/settings", `{"roots":[]}`, map[string]string{"Origin": "http://evil.example"})

	if res.StatusCode != 403 {
		t.Fatalf("got %d", res.StatusCode)
	}
}

func TestDirs(t *testing.T) {
	f := setup(t)

	var got []string
	json.NewDecoder(do(t, "GET", f.url+"/api/dirs?path="+f.root+"/", "", nil).Body).Decode(&got)

	if len(got) != 1 || got[0] != filepath.Join(f.root, "repo") {
		t.Fatalf("got %v", got)
	}
}

func TestSaveSettingsExcludes(t *testing.T) {
	f := setup(t)
	write(t, filepath.Join(f.root, "repo", "CHANGELOG.md"), "")
	body := `{"roots":[{"name":"code","path":"` + f.root + `"}],"exclude":["CHANGELOG.md"]}`

	res := do(t, "PUT", f.url+"/api/settings", body, nil)

	if got := settingsOf(t, res); res.StatusCode != 200 || len(got.Exclude) != 1 || got.Roots[0].Files != 1 {
		t.Fatalf("got %d %+v", res.StatusCode, got)
	}
}

func TestSaveSettingsActiveDays(t *testing.T) {
	f := setup(t)
	body := `{"roots":[{"name":"code","path":"` + f.root + `"}],"activeDays":30}`

	res := do(t, "PUT", f.url+"/api/settings", body, nil)

	if got := settingsOf(t, res); res.StatusCode != 200 || got.ActiveDays != 30 {
		t.Fatalf("got %d %+v", res.StatusCode, got)
	}
	if bad := do(t, "PUT", f.url+"/api/settings", `{"roots":[],"activeDays":1000}`, nil); bad.StatusCode != 400 {
		t.Fatalf("out of range got %d", bad.StatusCode)
	}
}
