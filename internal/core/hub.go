package core

import "sync"

// Event is pushed to every connected browser.
type Event struct {
	Name string
	Data any
}

// Hub fans events out to subscribers.
type Hub struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

// NewHub makes an empty hub.
func NewHub() *Hub { return &Hub{subs: map[chan Event]struct{}{}} }

// Subscribe returns a channel of events and a function to stop.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

// Broadcast sends an event to every subscriber; a subscriber too slow to
// take it misses it and catches up on reconnect.
func (h *Hub) Broadcast(name string, data any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- Event{Name: name, Data: data}:
		default:
		}
	}
}

// Count is the number of subscribers.
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}
