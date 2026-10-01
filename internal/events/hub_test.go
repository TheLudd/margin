package events

import "testing"

func TestPublishReachesSubscribers(t *testing.T) {
	hub := NewHub[string]()
	a, _ := hub.Subscribe()
	b, _ := hub.Subscribe()

	hub.Publish("changed")

	if <-a != "changed" || <-b != "changed" {
		t.Fatal("event not delivered")
	}
}

func TestSlowSubscriberIsDropped(t *testing.T) {
	hub := NewHub[int]()
	ch, _ := hub.Subscribe()

	for i := range buffer + 1 {
		hub.Publish(i)
	}

	for range buffer {
		<-ch
	}
	if _, open := <-ch; open {
		t.Fatal("slow subscriber should be closed")
	}
}

func TestUnsubscribeClosesOnce(t *testing.T) {
	hub := NewHub[int]()
	ch, unsubscribe := hub.Subscribe()

	unsubscribe()
	unsubscribe()
	hub.Publish(1)

	if _, open := <-ch; open {
		t.Fatal("channel should be closed")
	}
}
