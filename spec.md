---
status: draft
---

# margin — spec

What margin must do, as demands with ids. A rewrite is done when every demand has a test that names its id and passes. The look is specified by `spec/look.css`, the current stylesheet, and section 9 reads the demands out of it. Open questions are marked **OPEN** and must be settled before the list is final.

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
- **P-04** Flags: `-port` (default 48217), `-listen` (address to bind, default 127.0.0.1), `-config`, `-state`, `-host` (repeatable, another name margin accepts, such as `margin.local` behind a reverse proxy).
- **P-05** Binds to loopback by default. With `-listen` on an interface address or `0.0.0.0`, margin is reachable from other devices on the LAN, phones included.
- **P-06** Every request's `Host` header must name margin: localhost, the machine's hostname, any of its interface addresses as found at startup, or a `-host` name. This is what defeats DNS rebinding, where a web page open in the reader's own browser gets its domain pointed at margin's address and then reads every served file with plain GETs. An `Origin` header, when present, must match the `Host`. Binding to loopback does not make these checks unnecessary; the attacking page runs in the reader's browser, on the reader's machine.
- **P-11** **OPEN: authentication.** On the LAN, anyone on it can read and write the files. Either the spec says a home LAN is trusted and there is none, or a token given once in the URL and kept in a cookie is required for every request.
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
- **S-02** When a file counts as modified, and with what time, as computed today. **OPEN** together with S-01: these rules are what Recent is built on, and two of them are likely why it feels wrong (see the note after the list).
  - Outside git: the file's modification time on disk, always.
  - In the main checkout of a repository: modified only while git sees the file as changed against HEAD, or as untracked and not ignored. The time is the modification time on disk. Once committed, the file is no longer modified at all. A checkout, rebase or pull that rewrites a file does not make it modified.
  - In a linked worktree: modified if the file differs from the merge base of the worktree's HEAD and the main checkout's HEAD (where the branch forked), or is untracked. Uncommitted: the modification time on disk. Committed: the newest commit on the branch that touched it. The file stays modified until the branch is merged into main.
  - Recent takes, per file, the later of its modified time and its last view in margin, labels the entry with that kind, drops entries older than `activeDays` and entries dismissed since, and sorts latest first.
  - Note: in a main checkout a commit removes the committed files from Recent unless they were viewed in margin, so a session of writing and committing leaves nothing behind; and the main checkout and a worktree follow different rules for the same workflow.
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

The reference is `spec/look.css`, the stylesheet of the last build before the rewrite, copied verbatim. The rewrite may structure its CSS as it likes, but what is rendered must match the reference in everything listed here; the browser tests read computed styles and sizes. Where the reference and this list disagree, the reference wins, and the list gets fixed.

### Tokens

- **L-01** The palette is defined once, as CSS custom properties on `:root`, and used nowhere as literal colours:
  `bg #0a0b17`, `panel #10122a`, `raised #171a3a`, `line #2a2f63`, `text #d6dbff`, `muted #7f86c2`, `cyan #00e5ff`, `magenta #ff2bd6`, `h3 #8fa8ff`, `code #5cffa8`, `warn #ffb347`; for changes `added` = code, `modified` = warn, `removed #ff5c7a`. Dark colour scheme only.
- **L-02** Fonts: mono is `Source Code Pro`, then `DejaVuSansM Nerd Font`, then monospace. Sans is `system-ui`. Mono is used for everything that is chrome or structure: headings, the document header, the contents panel, the sidebar brand and section titles, times, counts, badges, kbd, the finder, settings controls. Sans is used for body text and the sidebar's file names.
- **L-03** The page background is bg with a magenta radial glow at top left (`#ff2bd61a` to transparent at 50%) and a cyan one at bottom right (`#00e5ff14`). Selection is magenta on bg. The caret is magenta. Scrollbars are 8px with a line-coloured rounded thumb.
- **L-04** Tints are made with `color-mix` of a token and transparent, never a second literal. Lit things glow: a `box-shadow` or `text-shadow` in the thing's own colour.

### Layout

- **L-05** Three columns: sidebar 290px, document, contents 300px. Without headings the contents column is gone, not empty. Nothing but the three panels scrolls; the document column is the scroller and keeps 60px scroll padding under its sticky header.
- **L-06** Below 1100px the contents panel hides and the sidebar is 240px. Below 700px the document stands alone under a top bar with two icon buttons; the sidebar and the contents slide in as drawers over a scrim (`#0a0b17b3`), the contents from the right. Esc or the scrim closes a drawer.
- **L-07** On wide screens the sidebar folds to a 48px strip holding only an unfold button; the × beside the brand folds it.
- **L-08** The text column has a 64px left and 48px right inset and 60px bottom padding; on phones 16px both sides. Wide code blocks and tables grow past the insets as D-11 says.

### Sidebar

- **L-09** Magenta 2px top border, line right border, translucent bg (`#0a0b17cc`), 13px text, 14px top padding. The brand `margin` is magenta mono beside a muted × that turns cyan on hover.
- **L-10** The search field shows `Open file…` and a `Ctrl K` kbd (hidden on phones).
- **L-11** Sections Recent and Older: uppercase letter-spaced mono 12px headings in a `details` summary with a ▸/▾ marker, a muted count at the right, 12px above each section. Project groups within Older use the same summary, indented 14px per level, with a raised background on hover.
- **L-12** A file entry: name in text colour, folder muted at 0.9em, a mono 11px time or `×n` copy count right-aligned. A view's time is muted, a modification's cyan. A changed copy count is cyan with a ● before it. The open file has a raised background and a magenta left border. The × that dismisses an entry shows on hover (always on phones) and turns magenta.
- **L-13** Unread: the time or count turns code green with a 4px glowing dot to its left, or the dot sits 6px from the right edge when there is neither (J-02).
- **L-14** Empty sections say `Nothing in the last 14 days` or `Nothing yet` in muted text.
- **L-15** The settings row sits at the foot, in view however long the lists get.

### Contents

- **L-16** 300px, line left border, mono 14px, 58px top padding so it aligns under the document header. `CONTENTS` in magenta uppercase letter-spaced 12px. Links are blocks with a 2px transparent left border; h1 and h2 in text colour, h3 indented 20px and h4 32px in muted. Hover magenta. The active heading is cyan with a cyan left border and is kept scrolled into view.

### Document header

- **L-17** Sticky at the top of the scroller, 10px by 32px padding, line bottom border, translucent bg (`#0a0b17e6`) with a 6px blur, mono 12px. Left: the file as in F-04, name in text colour. Then, when the file has copies, a cyan select. Right: the changes controls, then the badges.
- **L-18** Badges sit together in one line-coloured rounded box with no inner borders, 11px uppercase letter-spaced, 1px by 8px padding, muted at 0.6 opacity when stable. Widths as J-01. A lit badge has its tint at 15% as background and the tint as text; hovered or active clickable ones at 30%.
- **L-19** Changes controls: a count that is a borderless button (cyan underline on hover), ↑ ↓ buttons and `mark read` in code green, each 1px line border, panel bg, cyan border and text colour on hover, 0.4 opacity disabled.
- **L-20** The conflict and missing banner: 16px by 32px margin, warn border, 10px by 14px padding, text and buttons in a row.
- **L-21** On phones the header is 8px by 12px, badges become 24px symbol tiles as in L-26.

### Document body

- **L-22** Headings mono with 0.02em letter spacing. h1 magenta with a magenta glow and a magenta bottom border; h2 cyan with a cyan glow and a line bottom border; h3 in the h3 blue. Strong is white. Links cyan, magenta with glow on hover. Blockquotes have a 3px magenta left border on a faint magenta wash. A rule is a 2px magenta-to-cyan gradient. Table headers are cyan mono; even rows raised. Inline code is code green on the raised background and wraps as text (D-12).
- **L-23** Editing: the article gets a 2px magenta left border, a faint magenta wash and a magenta glow off its left edge; the block holding the cursor has a faint magenta wash extended 10px to each side.
- **L-24** The frontmatter panel is a `details` labelled `frontmatter` holding a textarea the height of its text.
- **L-25** Editor surface colours map onto the tokens: panel for surfaces, raised for hover and inline areas, cyan as primary, a magenta 20% selection, cyan glows for shadows, `#ff5c7a` for errors.
- **L-26** Phone badge symbols: manual ✎, committed ◆, uncommitted ±, untracked ?, saved ✓, unsaved •, saving …, conflict ⚠, deleted ✕, retrying ↻; 15px sans glyphs in 24px tiles, the words kept for screen readers.

### Changes

- **L-27** A changed block has a 3px rounded bar in the gutter 14px left of the text (plus 34px per list level), 2px inside its top and bottom, glowing in its colour: added green, modified amber. A removed block is drawn in place, struck through, 0.75 opacity, on a faint red wash with a red bar; collapsed to a 6px sliver with a notch when shown "as it is now". A rule too thin for a bar gets a 1px outline instead.
- **L-28** The current change has a faint cyan wash extended 10px to each side and its bar widens to 5px cyan with a glow; a reached jump pulses from a 30% cyan wash over 1.2s.
- **L-29** Word diffs: inserted text on a green 18% wash with a 1px green underline; deleted text struck through in red on a red 15% wash, not selectable. A block shown as it was sits on a faint red wash with a red bar and is not selectable; a note under it is muted italic.
- **L-30** Changed table cells are tinted amber at 14%, added cells green at 12%, over the row stripes.
- **L-31** The three view buttons stack vertically 34px left of the bar, 20px by 18px each, 1px line border, panel bg, muted mono 12px; cyan border and text when hovered, cyan when active. They show for the current change and while pointing at a change, and fade out after 0.4s (J-04).

### Finder

- **L-32** A centered dialog, `min(640px, 90vw)` wide, 12vh from the top, line border with a magenta 2px top, 6px radius, panel bg, a cyan glow, over a `#05060fb3` backdrop. Input 15px mono with a line bottom border. Results up to 50vh, 13px, in rows with 6px by 10px padding and 4px radius; the selected row raised with a 2px cyan inset left bar. Section titles muted uppercase mono 11px; the Older section starts with a line rule and its rows are at 0.6 opacity except the selected. The Tab line at the foot is muted mono 12px over a rule, cyan on hover.

### Pages and settings

- **L-33** Home, missing and setup pages are a 640px column 18vh from the top in muted text with a magenta glowing mono h1; settings is 820px, 10vh, in text colour.
- **L-34** Settings: cyan uppercase mono 11px section headings 40px apart; a roots grid of name 160px, folder, files 60px, remove 32px; inputs, selects and textarea in panel bg, line border, 4px radius, 14px mono, cyan border on focus; buttons raised with a line border, cyan on hover, the primary one magenta; the error box warn-bordered on a warn 10% wash; the file location in mono 12px at the foot.
- **L-35** Busy overlay: a dialog with a 32px spinner (line ring, magenta top, cyan right, 0.8s spin) and a mono 13px label over a blurred `#05060fcc` backdrop.

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

- **T-01** Every demand id appears in at least one test title. A script, `make coverage`, lists the ids that appear nowhere and exits non-zero if any do.
- **T-02** Go tests cover P, C, F, W, S-02, S-03, S-05, N-01, N-05 and CH-02 to CH-04, against a temp root with a real git repository and real file writes, through the HTTP layer where the demand is about an HTTP behaviour.
- **T-03** Vitest covers pure logic: S-10, D-04, D-05 (the corpus run is a separate `make roundtrip`), CH-05, CH-06, CH-08 grouping, N-02, N-06, N-07.
- **T-04** Browser tests (Playwright, against the built binary and a temp root) cover D, N-01, N-03, N-04, N-06, CH-05 to CH-12, every L demand by reading computed styles and sizes against `spec/look.css`, every J demand by comparing bounding boxes, and every K row.
- **T-05** The never-stale tests write to the file on disk in place and via rename, commit in the repo, and switch branches, and assert what the browser shows.
- **T-06** `make test` runs all three levels and `make coverage`.

## Open questions

1. **S-01** What should Recent list? The sidebar is the most visible part and has been reworked four times.
2. **W** Keep worktrees? Together with the HEAD watching they are about a quarter of the backend.
3. **CH-13** Keep the manual flag?
4. Should phones get editing, or stay read-only as now? With LAN access (P-05) phones are a real use, not a nicety.
5. Is the three-view-per-change (now, diff, was) wanted, or is one diff view enough?
6. **P-11** Authentication on the LAN: none, or a token?
