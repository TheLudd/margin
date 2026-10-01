// Package events fans events out to any number of subscribers.
package events

import "sync"

const buffer = 64

// Hub never blocks a publisher. A subscriber that falls behind is dropped
// (its channel is closed) rather than silently missing events, so it can
// reconnect and resynchronize.
type Hub[T any] struct {
	mu   sync.Mutex
	subs map[chan T]struct{}
}

func NewHub[T any]() *Hub[T] {
	return &Hub[T]{subs: map[chan T]struct{}{}}
}

// Subscribe returns a channel of events and a function that ends the
// subscription. The channel is closed when the subscription ends.
func (h *Hub[T]) Subscribe() (<-chan T, func()) {
	ch := make(chan T, buffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() { h.drop(ch) }
}

func (h *Hub[T]) Publish(event T) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- event:
		default:
			delete(h.subs, ch)
			close(ch)
		}
	}
}

func (h *Hub[T]) drop(ch chan T) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
}
