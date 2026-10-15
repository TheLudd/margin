---
status: draft
---

# margin — spec

What margin must do, as demands with ids. A rewrite is done when every demand has a test that names its id and passes, or is marked as covered by a reference screenshot. Open questions are marked **OPEN** and must be settled before the list is final.

Ids are stable: never renumber, never reuse a dropped one. A test names the ids it covers in its title, as in `"P-02, P-03: config falls back to ~/.config"`. A script lists the ids no test names.

## 1. Purpose

margin is a local, always-running service for reading the markdown files in a set of folders, in the browser. The files are typically written by an LLM; margin is where they are read and touched up. Reading is primary. Editing is for small things: a typo, a task ticked, a paragraph adjusted. What is on screen is never stale.

### Non-goals

- Creating, renaming or deleting files.
- Multi-user use or real-time collaboration.
- Polling, of any kind, anywhere.
- Full-text search.

## 2. Operation (P)

- **P-01** A single Go binary serves the frontend, embedded at build time. Node is needed only to build.
- **P-02** Config is read from `$XDG_CONFIG_HOME/margin/config.json`, falling back to `~/.config/margin/config.json`. A relative XDG value is ignored, as the XDG spec says.
- **P-03** State lives in `$XDG_STATE_HOME/margin/`, falling back to `~/.local/state/margin/`: views and dismissals, the copies of files as last read, the files marked manual.
- **P-04** Flags: `-port` (default 48217), `-config`, `-state`, `-host` (repeatable, another name margin accepts, such as `margin.local` behind a reverse proxy).
- **P-05** Binds to 127.0.0.1 only.
- **P-06** Every request's `Host` and `Origin` headers are checked against localhost and the `-host` names, against DNS rebinding and cross-site requests.
- **P-07** Every path is resolved, symlinks included, and anything outside its root is rejected.
- **P-08** Runs as a systemd user service; `make install` builds into `~/.local/bin/margin`.
- **P-09** The event stream starts with a build id. A tab connected to an older build saves its edits and reloads, so an install plus restart reaches every open tab.
- **P-10** File responses carry a content-hash etag and `Cache-Control: no-cache`; `If-None-Match` answers `304`; writes require `If-Match` and answer `412` on mismatch.

## 3. Config and settings (C)

- **C-01** Config keys: `roots` (name and path), `exclude` (patterns), `activeDays` (1–365, default 14), `unreadDays` (1–365, default 30), `changeView` (`blocks` or `words`, default `blocks`).
- **C-02** Validation: folders must exist, names must be unique, roots must not overlap. An invalid save is refused with a message and nothing changes.
- **C-03** Hand edits to the config file are picked up live. A broken file keeps the current roots and its error shows on the settings screen.
- **C-04** Without a usable root, margin serves nothing and the browser shows a setup screen asking for folders.
- **C-05** The setup and settings screens suggest the visible folders in home that hold markdown, with a file count for each (a lower bound if counting ran out of time). Folders already served are not suggested.
- **C-06** The folder field completes paths as typed; hidden folders only once a dot is typed; a leading `~` is kept. The name follows the folder's base name until edited.
- **C-07** Saving settings validates, writes the file, re-indexes in place without a restart, and covers the app with a busy overlay while re-indexing. Changing only the active window or change view applies without re-indexing.
- **C-08** Settings are reached by the gear at the foot of the sidebar, which stays in view however long the lists get, and at `/settings`.
- **C-09** The settings screen shows where the config is stored.

## 4. Files and indexing (F)

- **F-01** Every `.md` file under every root is indexed, except under `.git`, under `node_modules`, and anything a `.gitignore` ignores.
- **F-02** `exclude` patterns leave files out of the sidebar, search and recent activity. A pattern without a slash matches file names anywhere; one with a slash matches the end of a path. Case is ignored. A direct URL still opens an excluded file.
- **F-03** Paths and URLs start with the root's name, as in `/code/margin/plan.md`. With a single root, the name is left out of displayed paths but kept in URLs.
- **F-04** A file is shown the same way everywhere, in the sidebar, the finder and the document header: name first, then its folder in muted, slightly smaller text. The folder shrinks first; the name is cut only when it alone doesn't fit. In the sidebar both give way to the time and copy count.
- **F-05** Directories are watched, not files, so atomic rename-writes are caught. The index emits added, changed and removed events.
- **F-06** `.gitignore` changes are picked up on restart. (Live would be nicer; not demanded.)

### Worktrees (W) — **OPEN: keep, simplify or drop**

- **W-01** A file checked out in several git worktrees is listed once, grouped by project, in the sidebar and the finder, with a `×n` copy count.
- **W-02** A project is a main checkout plus the worktrees linked from it. Laid out as `<name>/<worktree>`, the project is called `<name>`. Separate clones are separate projects.
- **W-03** The copy that opens is the one changed last: a worktree has changed a file when it differs from the merge base with the main checkout's HEAD, committed or not. Committed changes date by their commit, uncommitted by mtime. No change anywhere: the main checkout's copy.
- **W-04** The document header lists every copy (main, unchanged, or changed when) and choosing one opens it. Edits always go to exactly the open file.
- **W-05** An explicit path (URL, link, recent entry) opens exactly that copy.
- **W-06** About a second after any change in a project, its copies are recomputed and the tree is pushed.

## 5. Sidebar and finder (S)

- **S-01** **OPEN: what Recent means.** Today: the files viewed in margin or modified within the active window, latest first, with a time per entry; a modification's time in cyan, a view's in muted. The last two commits restricted it to files opened in margin and then reverted that. The rewrite needs one definition, written here, before anything else in this section is tested against it.
- **S-02** Modified, in a git checkout, means changed and not committed (in the main checkout) or changed since it forked (in a worktree). Checkouts, rebases and pulls don't count. Outside git, it is the mtime.
- **S-03** Views are recorded only when a file is opened in margin, and kept with their time for 365 days.
- **S-04** Recent and Older are foldable sections with counts; Older groups files by project, each group foldable, sorted by name within. Fold state is kept per browser across reloads. Older stays folded when a file is opened from it.
- **S-05** The × on a Recent entry forgets its view and hides its activity up to now; a later view or change shows it again. Dismissals survive restarts.
- **S-06** The active window moves with time: the sidebar re-renders every 10 minutes even without changes. (This is a timer, not polling the server.)
- **S-07** Files with unread changes get a green mark by their time or copy count, or at the right edge when there is neither. Under Recent, the time itself turns green.
- **S-08** The sidebar folds to a 48px strip on wide screens and unfolds from it.
- **S-09** Ctrl K or Ctrl P opens the finder. An empty query lists recent activity. A query searches active files only; Tab (or the line at the foot, which counts the older matches) adds an Older section. Each section shows its best 10 and says `n of m` when cut. Enter opens, arrows move, click outside closes.
- **S-10** Matching: every query word must match within one path segment, as a substring or as an abbreviation of its words (`gcp` for `guarded-commands-plan`). Words shorter than three letters only match at a word start. Matches in the file name rank above matches in folders.
- **S-11** Sidebar links are real links: middle click and open-in-new-tab work; a plain click opens in place.

## 6. Document (D)

- **D-01** A file opens for reading. Selecting text to copy it changes nothing. E, or the edit badge, starts editing where the selection or click is; Esc stops it, unless it closes a menu first. E is ignored while typing in an input.
- **D-02** While editing, the page says so: an accent along the document, the block holding the cursor highlighted, a magenta cursor, the edit badge lit.
- **D-03** Edits autosave about a second after the last edit. Only real edits save; viewing never writes.
- **D-04** A save keeps the original bytes of every block not touched, so a one-word edit changes one block. Blocks are matched by structure, not position.
- **D-05** Round-trip: an unchanged save reproduces the file byte for byte for at least 551 of the 554-file corpus (`make roundtrip` over `~/code`). The three known exceptions are reference-style links, a `+ ` continuation line, and images without a title. Known block-level rewrites when a block is edited: reference links become inline.
- **D-06** Frontmatter is split off, shown as a panel folded by default, reattached byte for byte. Unfolded, the panel grows to its wrapped text and never scrolls. It is editable in edit mode.
- **D-07** Task lists: clicking a checkbox is an edit.
- **D-08** Mermaid blocks render as diagrams; in edit mode, clicking one opens the source with a live preview.
- **D-09** Code blocks are editable once editing starts.
- **D-10** The table of contents is built from h1–h4, is never part of the document, follows edits, highlights the heading in view (the last one at the bottom), and keeps the followed heading in view. Clicking a heading scrolls to it and puts its anchor in the URL, so a reload returns there. An existing `[[toc]]` is kept on save.
- **D-11** Code blocks and tables keep to the text's width unless their content is wider: then they grow evenly to both sides, centered on the text, up to a 24px gutter from the edges, and scroll only beyond that. Tables size to their cells and never fill the room just because it is there.
- **D-12** Long inline code stays on its line and wraps as text, not as a box.
- **D-13** Ctrl click on a link to another markdown file opens it in margin; other links open in a new tab.
- **D-14** The tab title is the file name; the header shows the file as in F-04.
- **D-15** A deleted or moved file shows a banner and edits are not saved.
- **D-16** Images without a title are rendered, not dropped. No LaTeX: `$` in prose is prose. No image resize feature that writes into the alt text.
- **D-17** Switching files while an edit is pending saves it first.

## 7. Never stale (N)

Any one mechanism is enough. All must exist.

- **N-01** Push: a change to the open file on disk reaches the browser and the document reloads, in place and via rename.
- **N-02** The echo of the browser's own save is ignored.
- **N-03** Revalidate on focus and on visibility: a conditional GET with the etag.
- **N-04** Revalidate on reconnect: after sleep or a service restart, the open file, tree, recent and unread lists are refetched. The stream is reopened after an error response (a proxy during restart) with backoff from 1s doubling to 10s.
- **N-05** Commits are pushed: `HEAD`, `logs/HEAD` and `packed-refs` of every checkout are watched; when HEAD moves, a `head` event names the repository and open files in it refetch their committed baseline.
- **N-06** Unsaved edits are never overwritten. An outside change while dirty shows a banner with keep mine and take theirs.
- **N-07** A failed save retries after 5s and the status says so.

## 8. Changes (CH)

- **CH-01** The open file is compared with a baseline: the version last read (unread) or last committed (uncommitted). Until the reader picks, unread is preferred, and a new unread change switches to it.
- **CH-02** margin keeps a copy of every file as last read. Opening a file without a copy stores the current version, so a never-opened file has no unread changes. Changes made while the browser is closed show on the next open.
- **CH-03** Mark read replaces the copy. A save in margin advances it, unless the copy holds unread changes. Several outside writes add up into one diff until marked read.
- **CH-04** Copies are kept `unreadDays` after last written, even while the file is gone, as after a branch switch; a sweep at startup, daily and on settings changes removes older ones.
- **CH-05** Bars: green beside a new block, amber beside a changed one, a red notch where blocks were removed. Table cells that changed are tinted; new rows in green. A code block or table counts as one block. Bars stay in the gutter at any list depth.
- **CH-06** Changed or removed blocks separated by at most one unchanged block are one change. The header counts them (`3 unread changes`) and the count is a button to the first.
- **CH-07** Alt ↑ and Alt ↓ and the header arrows step through changes. The target is centered and pulses once reached. A change jumped to is current (`Change 2 of 3`) until it leaves the screen. From no current change, stepping goes from the middle of the view.
- **CH-08** Beside each change, three buttons show it as it is now, as a diff, or as it was. In a diff, inserted words are highlighted and deleted words struck through; code blocks and tables show the old version above the new. A rewritten block is shown whole. The buttons sit left of the bar with room to cross the gutter and hide only after a delay.
- **CH-09** The default view is `changeView` from the config (blocks or words); a pick for one change stays while the file is open.
- **CH-10** The document stays editable with changes shown; the marks follow edits.
- **CH-11** A file in git shows a badge: `committed`, `uncommitted`, or `untracked` if never committed. `uncommitted` is tinted and clickable: it switches the baseline to the last commit and back. Files outside git show none.
- **CH-12** `mark read` shows only for the unread baseline.
- **CH-13** Manual — **OPEN: keep or drop.** A `manual` badge marks a file edited by hand in another editor; its changes count as read, as margin's own edits do. Toggling either way records the current version as read. Its uncommitted changes show only when asked for.
- **CH-14** Edits made in margin never show as unread changes.

## 9. Look (L)

Reference: a screenshot of the current build per layout (wide, no TOC, narrow, phone) taken before the rewrite, in `spec/screenshots/`. Demands below are the ones a test can measure; the screenshots carry the rest.

- **L-01** Palette, as CSS tokens and nowhere else:
  `bg #0a0b17`, `panel #10122a`, `raised #171a3a`, `line #2a2f63`, `text #d6dbff`, `muted #7f86c2`, `cyan #00e5ff`, `magenta #ff2bd6`, `h3 #8fa8ff`, `code #5cffa8`, `warn #ffb347`, `removed #ff5c7a`. Changes: added = code green, modified = warn, removed = `#ff5c7a`.
- **L-02** Fonts: mono is `Source Code Pro`, falling back to `DejaVuSansM Nerd Font`, then monospace; prose is `system-ui`. Headings, the document header, the TOC, the sidebar brand, badges and kbd are mono. Body text is sans.
- **L-03** Background: the bg colour with a magenta radial glow at top left and a cyan one at bottom right. Dark colour scheme only.
- **L-04** Headings in cyan, h3 in the h3 blue, inline code in the code green, selection magenta on bg, caret magenta, scrollbars 8px thin with a line-coloured thumb.
- **L-05** Sidebar: 290px, magenta 2px top border, line right border, 13px text. Brand `margin` in magenta mono. Search field with a `Ctrl K` kbd. Section headings uppercase, letter-spaced, with counts right-aligned.
- **L-06** Contents: 300px, line left border, mono 14px, `CONTENTS` in magenta uppercase, h1 and h2 in text colour, h3 and h4 indented and muted, the active heading cyan with a cyan left bar.
- **L-07** Document header: sticky, blurred bg, mono 12px, path left, changes controls and badges right.
- **L-08** Text column: 64px left inset, 48px right, 60px bottom padding. Edit-mode accent: 2px magenta left border on the article, a faint magenta wash and glow.
- **L-09** Breakpoints: below 1100px the contents panel hides and the sidebar is 240px; below 700px a single column with a top bar, the sidebar and contents as drawers over a scrim, editing not offered, 16px insets, larger targets (8px vertical padding), nothing that waits for hover, badges as symbols (✎ ◆ ± ? ✓ • … ⚠ ✕ ↻) at 24px with the words kept for screen readers.
- **L-10** Pages that aren't a document (home, missing, settings) are a centered column, 640px (settings 820px), with a magenta mono h1.

## 10. Nothing jumps (J)

A general rule, then its instances: no state change moves any element that didn't change. Each instance is measured in a browser: the bounding boxes of neighbours before and after are equal.

- **J-01** Header badges are each as wide as their longest value (`uncommitted` 11 chars, `editing` 7, `manual` 6, `retrying` 8), uppercase, letter-spaced, centered. Stable values are dim; a changing one is tinted (cyan for saving, warn for uncommitted and untracked, magenta for editing and manual, removed red for conflict, deleted, retrying).
- **J-02** The unread mark in the sidebar is drawn in existing padding; marking files read moves nothing.
- **J-03** Times and copy counts stay visible beside long file names; the name is cut instead.
- **J-04** The change buttons beside a change stay in reach: they hide only after a delay, so the pointer can cross the gutter to them.
- **J-05** The changes controls in the header appear and disappear without moving the badges.
- **J-06** The frontmatter panel grows to its text; nothing scrolls inside it.
- **J-07** Wide tables do not let the article's focus border show through their cells.

## 11. Keys (K)

| Key | Where | Does |
|---|---|---|
| E | document | start editing |
| Esc | editing | stop editing (closes a menu first if one is open); closes a drawer |
| Ctrl K, Ctrl P | anywhere | open the finder |
| ↑ ↓, Enter, Tab | finder | move, open, toggle older files |
| Alt ↑, Alt ↓ | document with changes | previous and next change |
| Ctrl click | link to a `.md` | open in margin |
| middle click | sidebar link | open in a new tab |

## 12. Tests (T)

- **T-01** Every demand id appears in at least one test title, or in a `spec/screenshots/` note for a look-only demand. A script, `make coverage`, lists the ids that appear nowhere and exits non-zero if any do.
- **T-02** Go tests cover P, C, F, W, S-02, S-03, S-05, N-01, N-05 and CH-02 to CH-04, against a temp root with a real git repository and real file writes, through the HTTP layer where the demand is about an HTTP behaviour.
- **T-03** Vitest covers pure logic: S-10, D-04, D-05 (the corpus run is a separate `make roundtrip`), CH-05, CH-06, CH-08 grouping, N-02, N-06, N-07.
- **T-04** Browser tests (Playwright, against the built binary and a temp root) cover D, N-01, N-03, N-04, N-06, CH-05 to CH-12, every L demand that names a size or colour, every J demand by comparing bounding boxes, and every K row.
- **T-05** The never-stale tests write to the file on disk in place and via rename, commit in the repo, and switch branches, and assert what the browser shows.
- **T-06** `make test` runs all three levels and `make coverage`.

## Open questions

1. **S-01** What should Recent list? The sidebar is the most visible part and has been reworked four times.
2. **W** Keep worktrees? Together with the HEAD watching they are about a quarter of the backend.
3. **CH-13** Keep the manual flag?
4. Should phones get editing, or stay read-only as now?
5. Is the three-view-per-change (now, diff, was) wanted, or is one diff view enough?
