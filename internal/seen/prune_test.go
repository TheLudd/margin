package seen

import (
	"context"
	"os"
	"testing"
	"time"

	"margin/internal/index"
)

func TestPrunerForgetsOldVersions(t *testing.T) {
	s := open(t)
	s.Put("code/a.md", []byte("v1"))
	old := time.Now().Add(-48 * time.Hour)
	os.Chtimes(s.file("code/a.md"), old, old)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	subscribe := func() (<-chan index.Event, func()) { return make(chan index.Event), func() {} }

	go (&Pruner{Store: s, Keep: func() time.Duration { return 24 * time.Hour }}).Run(ctx, subscribe)

	for range 50 {
		if _, ok, _ := s.Get("code/a.md"); !ok {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("old version kept")
}
