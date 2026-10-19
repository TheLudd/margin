# margin

A local, always-running service for reading the markdown files in a set of folders, in the browser. The files are typically written by an LLM; margin is where they are read and touched up. Reading is primary. Editing is for small things: a typo, a task ticked, a paragraph adjusted. What is on screen is never stale.

margin does not create, rename or delete files, has no multi-user mode, never polls, and has no full-text search. The demands it meets are listed with ids in [spec.md](spec.md); every test names the ids it covers.

## What it does

- **Sidebar.** Recent lists every file viewed in margin or modified within the active window (14 days by default), latest first. A file is modified when its content on disk differs from the copy margin kept when you last read it, however the change got there; git plays no part. A file nobody has opened is never modified, so files an LLM just wrote wait under Older, grouped by project, until they are opened. Unread changes get a green mark. The × on an entry forgets it until something new happens. The sidebar folds to a strip, and the gear at its foot leads to the settings.
- **Types.** Files whose name says little, like every project's `CLAUDE.md` or every skill's `SKILL.md`, get a type in the settings: a pattern, a name and an optional mark. A typed file shows its mark as a small tag and is named by the part of its path the pattern leaves open, so `margin/CLAUDE.md` is listed as `margin` tagged `claude`, and `margin/.claude/skills/commit/SKILL.md` as `commit` under `margin`. The finder finds it by the type's name as well. The settings suggest types from the file names that recur across the indexed folders, with the pattern that fits them.
- **Finder.** Ctrl K or Ctrl P. An empty query lists recent activity; a query searches the active files, and Tab adds the older ones. Every word of the query must match within one path segment, as a substring or an abbreviation (`gcp` for `guarded-commands-plan`); matches in the file name rank first.
- **Document.** Files open for reading. E or the edit badge starts editing where you clicked, Esc stops. Edits autosave a second after the last keystroke, and a save keeps the original bytes of every block you did not touch, so a one-word edit changes one block. Frontmatter sits in a folded panel. Task checkboxes are edits. Mermaid blocks render as diagrams. The contents panel follows the headings and the one in view. Ctrl click on a link to another markdown file opens it in margin.
- **Never stale.** Changes on disk, written in place or by rename, and commits are pushed to the browser; the open file is revalidated on focus and on reconnect; the stream reopens with backoff after a restart; a tab on an older build saves and reloads. Unsaved edits are never overwritten: an outside change while editing shows a banner with keep mine and take theirs. A failed save retries after five seconds.
- **Changes.** The open file is compared with the version you last read: green bars beside new blocks, amber beside changed ones, a red notch where blocks were removed, tinted cells in tables. Nearby changes count as one; the header counts them, Alt ↑ and Alt ↓ step through them, and three buttons beside each change show it as it is now, as a diff, or as it was. Mark read clears them. A file in git shows committed, uncommitted or untracked; clicking uncommitted compares with the last commit instead. A file marked manual, edited by hand elsewhere, counts its changes as read. Your own edits in margin never show as unread.
- **Worktrees.** A file checked out in several git worktrees is listed once with a copy count and opens the copy changed last; the header lists every copy.

## Install

Requires Go 1.27 and pnpm to build. The result is one static binary with the frontend embedded.

```bash
make install    # builds and installs ~/.local/bin/margin
margin          # serves http://localhost:48217
```

On first run the browser shows a setup screen that suggests the folders in your home holding markdown.

### As a systemd user service

```ini
# ~/.config/systemd/user/margin.service
[Unit]
Description=margin, markdown reader

[Service]
ExecStart=%h/.local/bin/margin
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now margin
systemctl --user restart margin   # after make install; open tabs reload themselves
```

## Configuration

Settings are edited on the settings screen (the gear in the sidebar, or `/settings`) and stored in `$XDG_CONFIG_HOME/margin/config.json`, falling back to `~/.config/margin/config.json`. Hand edits are picked up live; a broken file keeps the current folders and shows its error on the settings screen.

```json
{
  "roots": [{ "name": "code", "path": "~/code" }, { "name": "notes", "path": "~/notes" }],
  "exclude": ["CHANGELOG.md", "generated/*.md"],
  "types": [
    { "name": "claude", "match": "CLAUDE.md" },
    { "name": "skill", "match": ".claude/skills/*/SKILL.md", "mark": "✦" }
  ],
  "activeDays": 14,
  "unreadDays": 30
}
```

- **`roots`** are the folders served. The name is the first part of every address, as in `/code/margin/plan.md`; with a single root it is left out of displayed paths. Folders must exist, names must be unique and not `api`, `assets` or `settings`, and roots must not overlap.
- **`exclude`** leaves files out of the sidebar, the finder and recent activity. A pattern without a slash matches file names anywhere; one with a slash matches the end of a path. Case is ignored. An excluded file still opens by its address.
- **`types`** name files by their path instead of their file name. A file matching `match` (same grammar as `exclude`, first match wins) is tagged with `mark`, or with the name when there is no mark, and named by what the pattern leaves open: the pattern's fixed segments are dropped from the path and the rightmost segment left is the name. `CLAUDE.md` names `margin/CLAUDE.md` `margin`; `.claude/skills/*/SKILL.md` names the skill folder and drops the `.claude/skills` in between, where a bare `SKILL.md` would keep it in the folder.
- **`activeDays`** (1–365) is the window that divides Recent from Older.
- **`unreadDays`** (1–365) is how long the copy of a file as last read is kept after it was last written, even while the file is gone, as after a branch switch. After that the file counts as never opened.

Every `.md` file under every root is served except under `.git`, under `node_modules`, and what a `.gitignore` ignores. Changes to `.gitignore` files are picked up on restart.

State lives in `$XDG_STATE_HOME/margin/`, falling back to `~/.local/state/margin/`: views and dismissals, the files marked manual, and the copies of files as last read.

### Flags

| Flag | Default | |
|---|---|---|
| `-port` | `48217` | Port to listen on; `0` picks a free one and prints it |
| `-listen` | `127.0.0.1` | Address to bind; an interface address or `0.0.0.0` opens margin to the LAN, phones included |
| `-config` | see above | Config file |
| `-state` | see above | State folder |
| `-host` | | Another name margin is reached by, such as `margin.local` behind a reverse proxy (repeatable) |

## Security

Every request's `Host` header must name margin: localhost, the machine's hostname, any of its interface addresses as found at startup, or a `-host` name. An `Origin` header, when present, must match the `Host`. This defeats DNS rebinding, where a page open in your own browser gets its domain pointed at margin's address. Every path is resolved, symlinks included, and anything outside its root is rejected. There is no authentication: the LAN margin is opened to is trusted.

## Keys

| Key | Where | Does |
|---|---|---|
| E | document | start editing |
| Esc | editing | stop editing (closes a menu first if one is open); closes a drawer |
| Ctrl K, Ctrl P | anywhere | open the finder |
| ↑ ↓, Enter, Tab | finder | move, open, toggle older files |
| Alt ↑, Alt ↓ | document with changes | previous and next change |
| Ctrl click | link to a `.md` | open in margin |
| middle click | sidebar link | open in a new tab |

## Development

```bash
make                 # build the frontend and the binary
make test            # go tests, vitest, and playwright against the built binary
make roundtrip       # D-05: report the files under ~/code an unchanged save would alter
cd web && pnpm dev   # vite dev server proxying /api to a running margin
```

The service is Go (`internal/`): the index with its folder watches, git by shelling out, the projects and worktrees, the state, the lists, the core that ties them together, and the HTTP layer with etags and the event stream. The frontend (`web/`) is TypeScript with Vite and no framework; the editor is Milkdown kit without Crepe, loaded with the first document opened so the chrome stays small. Mermaid loads only when a document has a mermaid block.

Tests run at three levels and every test names the demands it covers: Go unit tests per package against temp roots with real repositories, Go integration tests through the HTTP layer, Vitest unit and DOM tests for the frontend, and Playwright end-to-end tests that start the built binary over a temp root for every visible demand. The look is checked by reading computed styles against `spec/look.css`, and the nothing-jumps rules by comparing bounding boxes before and after a change.
