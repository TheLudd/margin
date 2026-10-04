---
status: implemented
---

# margin — plan

A local, always-running service to browse and edit the markdown files in a set of configured folders (such as `~/code`) in the browser. It replaces `mp` (nvim + markdown-preview) for reading what Claude writes.

## Goals

- Browse every `.md` file in the configured folders from the browser.
- Read and edit in the same view, with WYSIWYG editing and no separate source pane.
- Show a TOC sidebar for every document, without needing `[[toc]]` in the file.
- Never show a stale document.
- Recently viewed and recently modified lists.

## Non-goals

- Creating, renaming or deleting files. margin only edits existing files.
- Real-time collaboration and multi-user support.

## Stack

| Part | Choice | Why |
|---|---|---|
| Backend | Go | Single static binary, fsnotify, stdlib HTTP, easy to run as a systemd user service |
| Frontend | TypeScript + Vite | Built once, embedded in the binary with `embed.FS`; node is needed only at build time |
| Editor | Milkdown | Markdown-native WYSIWYG (ProseMirror + remark), with GFM and plugin support |
| Diagrams | mermaid | Loaded only when a document contains a mermaid block |

## Architecture

```
Go service (127.0.0.1:<port>)
├── workspace one index, file store and worktree tracker per configured root
├── index    walks a root, keeps an in-memory list of .md files, watches with inotify
├── files    read/write with path checks and content-hash etags
├── recent   viewed + modified history, JSON in ~/.local/state/margin/
├── seen     every file as last read, for showing unread changes
├── events   SSE stream: changed / added / removed
└── api      HTTP handlers + embedded frontend

Browser
├── sidebar  files grouped by repo, fuzzy finder (Ctrl+K), recent lists
├── editor   Milkdown, always editable, autosave
└── toc      sticky panel built from the headings
```

### Backend packages

Each package does gsone job and can be tested without the HTTP layer.

- **`index`** — walks a root and returns the set of markdown files. It skips `.git`, `node_modules` and anything matched by a `.gitignore`. It watches directories, not files, so atomic rename-writes are still caught, and emits add/change/remove events.
- **`files`** — reads a file and returns its content plus an etag (a content hash). Writes are conditional on the etag the client sent. It resolves symlinks and rejects any path outside its root.
- **`recent`** — records views and modifications and persists them to `~/.local/state/margin/recent.json`. The lists are capped.
- **`seen`** — keeps a copy of every file as last read in margin, in `~/.local/state/margin/seen/`. margin only learns of a change after it is made, so a file's first version found by the index counts as read. Marking a file read replaces the copy; a save made in margin advances it too, unless the copy holds unread changes. A copy is kept for `unreadDays` (30 by default) after it was last written, even while the file is gone, as after a branch switch; a sweep at startup, daily and on settings changes deletes older copies and stores the current version of files left without one.
- **`events`** — fans index events out to the SSE subscribers.
- **`api`** — handlers only, wiring the packages together.

### API sketch

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tree` | All markdown files, grouped by repo |
| GET | `/api/file?path=` | Content + `ETag`; answers `If-None-Match` with `304` |
| PUT | `/api/file?path=` | Save; requires `If-Match`, otherwise `412` |
| GET | `/api/seen?path=` | The file as last read |
| PUT | `/api/seen?path=` | Mark the version with the `If-Match` etag read; otherwise `412` |
| GET | `/api/committed?path=` | The file as committed in `HEAD`; `404` when not committed |
| GET | `/api/recent` | Recently viewed and recently modified |
| GET | `/api/events` | SSE stream |
| GET | `/<path>` | Opens the SPA on that file (deep link used by `mp`) |

## Never stale

Several independent mechanisms; any one of them is enough to catch a change.

1. **Push.** The watcher sees a change to the open file, the server sends an SSE event, and the client reloads.
2. **Revalidate on focus.** On `visibilitychange` or focus, the client sends a conditional GET with its etag and gets either `304` or the new content. This works even if inotify missed something.
3. **Revalidate on reconnect.** When the SSE stream reconnects (after sleep or a service restart), the client revalidates the open file, because events sent while it was down are lost.
4. **No HTTP caching.** File responses are `Cache-Control: no-cache` with an etag.

Details:

- The etag is a content hash, not mtime, because mtime granularity can hide rapid writes.
- The client ignores a change event whose etag matches its own last save, which is the echo of its own autosave.
- If the client has unsaved edits when an outside change arrives, it shows a banner (keep mine / take theirs) and never silently overwrites. This is rare given the workflow, but it is handled.

Integration test: open a file, modify it on disk both in place and via rename, and assert that the client gets the new content.

## Editor

- **Autosave** fires on a debounce (~1s) after the last edit, and only after a real edit. Viewing never writes.
- **Frontmatter** is split off on load, shown as a collapsible metadata block, and reattached byte-for-byte on save. This covers SKILL files.
- **TOC** is UI chrome built from the headings and is never part of the document. An existing `[[toc]]` in a file is rendered as a small placeholder and kept on save.
- **Task lists**: clicking a checkbox is a normal edit (`[ ]` → `[x]`).
- **Mermaid**: the block renders as a diagram; clicking it opens the source with a live preview.
- **Theme**: ported from `newdotfiles/config/nvim/markdown-preview/cyberpunk.css`.

### Round-trip fidelity

The main risk. Milkdown serializes the whole document on save, which can normalize formatting (`*` → `-`, table padding, wrapping) and produce noisy diffs.

- Tune the remark-stringify options to match the style Claude writes in (`-` bullets and rules).
- **Source-preserving save** (`preserveSource`): the original and the edited markdown are split into top-level blocks and matched by structure (LCS over the mdast with positions removed). Untouched blocks keep their original bytes, so a one-word edit gives a one-block diff.
- **Round-trip report** (`make roundtrip`): loads every unique `.md` under `~/code` into the editor and lists the files an unchanged save would not reproduce exactly.

## Configuration

The folders margin serves (roots) are listed in `$XDG_CONFIG_HOME/margin/config.json`, falling back to `~/.config/margin/config.json`:

```json
{ "roots": [{ "name": "code", "path": "~/code" }, { "name": "notes", "path": "~/notes" }] }
```

- **Paths and URLs** start with the root's name: `/code/gaius/plan.md`. With a single root the name is left out of displayed paths, but kept in URLs.
- **First run:** without a usable config, margin serves nothing and the browser shows a setup screen asking for folders.
- **Settings** (`/settings`, the gear in the sidebar) adds, removes and renames roots. Saving validates the folders (they must exist, names must be unique, roots must not overlap), writes the file and re-indexes in place, without a restart.
- **Hidden files:** `"exclude"` lists file patterns to leave out of the index, and with it the sidebar, search and recent activity (a direct URL still opens them). A pattern without a slash matches the file name anywhere (`CHANGELOG.md`, `*.draft.md`); one with a slash matches the end of the path (`generated/*.md`). Case is ignored. Edited on the settings screen, one pattern per line.
- **Hand edits** to the file are picked up live. A broken file keeps the current roots and its error is shown on the settings screen.
- **Views** recorded before roots were named are moved to the root that has the file.

## Worktrees

The same file checked out in several git worktrees is shown once in the sidebar and the finder, grouped by project. A project is a main checkout plus its linked worktrees, found by following each worktree's `.git` file. When they are laid out as `<name>/<worktree>`, the project is called `<name>`.

- **Default copy:** where the file was last changed. A worktree has changed a file when it differs from the merge base with the main checkout's HEAD, committed or not (`git diff <merge-base>` plus untracked files). Committed changes are dated by their last commit and uncommitted ones by modification time, because checkout resets modification times. If no worktree changed the file, the main checkout's copy opens.
- **Switcher:** the document header lists every copy (main / unchanged / changed when), and choosing one opens it. Edits always go to exactly the file that is open.
- **Explicit paths** (`mp`, links, the recent lists) open exactly that copy.
- **Freshness:** the tracker recomputes a project about a second after any change in it, and pushes a `tree` event so clients refetch the tree.
- **Separate clones** (such as `*-backup`) are separate projects.

## Activity

The sidebar lists only files viewed in margin or modified within the active window, counted back from now: 14 days by default, set with `"activeDays"` in the config or on the settings screen (1–365). Projects are sorted by their latest activity. Everything else is folded under **Older**, which expands to the full project tree. Search covers active files only; Tab (or the line at the bottom of the results, which counts the older matches) adds an Older section. Each section shows its best 10 matches. Every query word must match within one path segment, as a substring or an abbreviation of its words; words shorter than three letters only match at a word start.

- **Viewed** means opened in margin; other apps are not considered. Views are kept with their time for 365 days (the longest window) in `~/.local/state/margin/recent.json`.
- **Modified** is the modification time for main checkouts and plain repositories, and the git change time for a worktree's own copy, because checkouts reset modification times.
- The window moves with time: the sidebar re-renders every 10 minutes even without changes.
- **Recent activity** at the top of the sidebar merges views and modifications within the active window: up to the 8 most recent files, each marked by whichever happened last (✎ for modified).
- Changing only the active window applies at once; changing folders or hidden files re-indexes.
- **Removing from recent activity:** the × on an entry forgets its view and hides its activity up to now; a later view or change shows it again. Dismissals are kept with the views.
- Both sidebar sections fold, and fold state is kept per browser across reloads.

## Changes

The open file is compared with a baseline: the version last read (unread changes) or the one last committed (uncommitted changes). Until the reader picks one, unread changes are preferred and new ones switch to them. Several writes add up into one diff until the file is marked read.

The diff is Milkdown's `computeDocDiff` (block LCS, recursing into lists and tables) widened to whole words, drawn as ProseMirror decorations: inserted text highlighted, deleted text as struck-through widgets, removed blocks rendered where they were, and a gutter bar on every changed textblock. The document itself is untouched, so it stays editable and the changes follow edits.

## Editing state

While editing, the page shows it: an EDITING label in the header, an accent along the document, the block holding the cursor highlighted, and a high-contrast cursor. Esc stops editing, unless it closes a menu first.

## Security

- Binds to `127.0.0.1` only.
- Validates the `Host` and `Origin` headers, against DNS rebinding and cross-site requests from pages open in the browser.
- Resolves every path (including symlinks) and rejects anything outside its root.
- The settings screen can change which folders margin serves and suggests folders anywhere on disk; it is protected by the same host and origin checks.

## Integration with newdotfiles

- `installs/margin` — builds and installs the binary. Requires installing `go`, which is currently missing.
- `setups/margin` — installs and enables a systemd user unit.
- `nginx/margin.conf` + `setups/nginx` — serve margin at http://margin.local through nginx on port 80; margin is started with `-host margin.local` so it accepts that name.
- `bin/mp` — replaces the `mp` alias and opens `http://localhost:<port>/<path>`.
- Optional: a dunst notification with a link when a markdown file changes, so files Claude writes are one click away.

## Phases

1. **Read-only** — index + watcher, file API, SSE, all of the "never stale" mechanisms, sidebar, fuzzy finder, TOC, mermaid, recent lists.
2. **Editing** — autosave, conditional writes, frontmatter preservation, task lists, conflict banner, round-trip test.
3. **Integration** — systemd unit, install/setup scripts, `bin/mp`, theme, notifications.

## Environment notes

- `fs.inotify.max_user_watches` is 524288, plenty for `~/code` once the ignored directories are skipped.
- Node v20 is available; Go is not installed yet.

## Decisions

- Port 48217.
- No full-text search for now.
- Eight entries in the recent activity list.

## Implementation notes

- **Round-trip result** (2026-10-01): 551 of 554 unique files under `~/code` survive an unchanged save byte for byte (86 without `preserveSource`). The remaining 3 are known Milkdown limitations, listed below.
- **Milkdown workarounds**:
  - Images without a title crash Milkdown's parser and get dropped. A remark plugin defaults the title to `''`.
  - Crepe's image-block feature stores its size ratio in the alt text, so it is disabled.
  - The LaTeX feature is disabled, because it would parse `$` in prose as math.
- **Known limitations** (they only affect a block you edit):
  - Reference-style links (`[a4]` plus a definition) are rewritten as inline links.
  - Milkdown re-indents a paragraph continuation line starting with `+ `, which turns it into a nested list.
- **`.gitignore` changes** are picked up on restart, not live.
- **Not done**: the dunst notification for files Claude writes.

## Development

```bash
make            # build web/dist and the binary
make test       # go tests + vitest
make install    # ~/.local/bin/margin
make roundtrip  # fidelity report over ~/code
cd web && pnpm dev   # Vite dev server against the running service
```
