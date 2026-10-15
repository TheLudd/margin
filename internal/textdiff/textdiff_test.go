package textdiff

import (
	"strings"
	"testing"
)

func TestDiff(t *testing.T) {
	t.Run("CH-03: a line diff finds equal, removed and added lines", func(t *testing.T) {
		ops := Diff(Lines("a\nb\nc\n"), Lines("a\nx\nc\nd\n"))
		var kinds strings.Builder
		for _, op := range ops {
			kinds.WriteByte(op.Kind)
		}
		if kinds.String() != "=-+=+" {
			t.Fatalf("got %q (%+v)", kinds.String(), ops)
		}
		if ops := Diff(nil, nil); len(ops) != 0 {
			t.Fatal("empty diff")
		}
		if ops := Diff(Lines("a\n"), Lines("a\n")); len(ops) != 1 || ops[0].Kind != '=' {
			t.Fatal("equal diff")
		}
	})
}

func TestRebase(t *testing.T) {
	copyText := "# Title\n\nFirst para.\n\nSecond para.\n\nThird para.\n"
	// On disk, the second paragraph changed (unread), the rest is as read.
	disk := "# Title\n\nFirst para.\n\nSecond para, changed outside.\n\nThird para.\n"

	t.Run("CH-14, CH-03: the reader's edit to an unchanged block lands in the copy; the unread change stays", func(t *testing.T) {
		edited := "# Title\n\nFirst para, edited.\n\nSecond para, changed outside.\n\nThird para.\n"
		got := Rebase(copyText, disk, edited)
		want := "# Title\n\nFirst para, edited.\n\nSecond para.\n\nThird para.\n"
		if got != want {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("CH-03: an edit inside the unread change is left out of the copy, so it stays unread", func(t *testing.T) {
		edited := "# Title\n\nFirst para.\n\nSecond para, changed outside and then by me.\n\nThird para.\n"
		got := Rebase(copyText, disk, edited)
		if got != copyText {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("CH-14: added and removed blocks next to shared lines carry over", func(t *testing.T) {
		edited := "# Title\n\nNew first.\n\nFirst para.\n\nSecond para, changed outside.\n"
		got := Rebase(copyText, disk, edited)
		want := "# Title\n\nNew first.\n\nFirst para.\n\nSecond para.\n"
		if got != want {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("CH-14: with no unread changes the edit simply replaces the copy", func(t *testing.T) {
		edited := "# Title\n\nFirst para, edited.\n\nSecond para.\n\nThird para.\n"
		if got := Rebase(copyText, copyText, edited); got != edited {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("CH-14: an insertion at the top and a file without a final newline", func(t *testing.T) {
		if got := Rebase("a\nb", "a\nb", "z\na\nb"); got != "z\na\nb" {
			t.Fatalf("top: %q", got)
		}
		if got := Rebase("a\nb\n", "a\nb\n", "a\nb\nc"); got != "a\nb\nc" {
			t.Fatalf("end: %q", got)
		}
	})
}
