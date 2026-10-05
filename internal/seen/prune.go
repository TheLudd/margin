package seen

import (
	"context"
	"log"
	"time"

	"margin/internal/index"
	"margin/internal/workspace"
)

const sweepInterval = 24 * time.Hour

// Pruner forgets versions read too long ago.
type Pruner struct {
	Store *Store
	Keep  func() time.Duration // how long a version read is kept
}

// Run prunes now, daily and whenever the settings may have changed, until
// ctx is done. subscribe is called again whenever the event stream ends.
func (p *Pruner) Run(ctx context.Context, subscribe func() (<-chan index.Event, func())) {
	for ctx.Err() == nil {
		events, unsubscribe := subscribe()
		p.prune()
		p.follow(ctx, events)
		unsubscribe()
	}
}

func (p *Pruner) follow(ctx context.Context, events <-chan index.Event) {
	daily := time.NewTicker(sweepInterval)
	defer daily.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			if ev.Kind == workspace.TreeChanged { // the settings may have changed
				p.prune()
			}
		case <-daily.C:
			p.prune()
		}
	}
}

func (p *Pruner) prune() {
	if err := p.Store.Prune(p.Keep()); err != nil {
		log.Printf("seen: %v", err)
	}
}
