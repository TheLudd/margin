# margin

A local service for reading and editing the markdown files in your folders, in the browser. It runs in the background, lists every `.md` file in the folders you choose, and opens each one in a WYSIWYG editor with a table of contents. What is on screen is never stale: changes made on disk show up at once.

It is meant mainly for reading, with minor edits on the side: fixing a typo, ticking a task, adjusting a paragraph. It is intended for files typically written by an LLM; margin is where you read them and touch them up.

## Features

- **Sidebar:** Recent lists the files viewed or modified within the active window (14 days by default), latest first. Older holds every other file, grouped by project.
- **Finder:** Ctrl K fuzzy-searches the recent files; Tab adds the older ones.
- **Editor:** always editable, with autosave. Saves keep the original bytes of every block you didn't touch, so a one-word edit changes only that block. Frontmatter, task lists and mermaid diagrams are supported.
- **Table of contents** built from the headings of every document.
- **Changes:** the open file shows what changed since you last read it (**unread**) or since its last commit (**uncommitted**): new words highlighted, removed ones struck through, a bar beside every changed block. Alt ↑/↓ steps through them; **mark read** clears the unread ones. margin keeps a copy of every file as you last read it, so changes made while the browser is closed show too. Your own edits in margin count as read.
- **Never stale:** changes on disk are pushed to the browser, and the open file is revalidated on focus and on reconnect. Unsaved edits are never overwritten; a banner asks which version to keep.
- **Worktrees:** a file checked out in several git worktrees is listed once and opens the copy changed last.
- **`.gitignore` aware:** ignored files, `.git` and `node_modules` are left out.

margin doesn't create, rename or delete files.

## Install

Requires Go 1.27 and pnpm.

```bash
make install    # builds the frontend and the binary into ~/.local/bin/margin
margin          # serves http://localhost:48217
```

On first run, the browser shows a setup screen. It suggests the folders in your home that hold markdown; pick the ones to serve.

### As a systemd user service

```ini
# ~/.config/systemd/user/margin.service
[Unit]
Description=margin, markdown reader/editor

[Service]
ExecStart=%h/.local/bin/margin
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now margin
systemctl --user restart margin   # after make install
```

## Configuration

Settings are edited on the settings screen (the gear in the sidebar) and stored in `$XDG_CONFIG_HOME/margin/config.json`, falling back to `~/.config/margin/config.json`. Hand edits are picked up live.

```json
{
  "roots": [{ "name": "code", "path": "~/code" }, { "name": "notes", "path": "~/notes" }],
  "exclude": ["CHANGELOG.md", "generated/*.md"],
  "activeDays": 14,
  "unreadDays": 30
}
```

- **`roots`** are the folders served. Each name is the first part of every path in it, as in `/code/margin/plan.md`. Folders must exist, names must be unique and roots must not overlap.
- **`exclude`** leaves files out of the sidebar, search and recent activity. A pattern without a slash matches file names anywhere; one with a slash matches the end of a path. Case is ignored.
- **`activeDays`** (1–365) is the window that divides Recent from Older.
- **`unreadDays`** (1–365) is how long after you last read a file its unread changes are kept, even while the file is gone, as after switching branches. After that, its current version counts as read.

Views are kept in `$XDG_STATE_HOME/margin/recent.json`, falling back to `~/.local/state/margin/`, and the copies of files as last read in `seen/` next to it.

### Flags

| Flag | Default | |
|---|---|---|
| `-port` | `48217` | Port to listen on, on 127.0.0.1 only |
| `-config` | see above | Config file |
| `-state` | see above | Directory for margin's own state |
| `-host` | | Another name margin is reached by, such as `margin.local` behind a reverse proxy (repeatable) |

## Security

margin binds to 127.0.0.1 only and checks the `Host` and `Origin` headers of every request, against DNS rebinding and cross-site requests from other pages. Every path is resolved, symlinks included, and anything outside its root is rejected.

## Development

```bash
make                 # build web/dist and the binary
make test            # go tests + vitest
make roundtrip       # report the markdown files under ~/code an unchanged save would alter
cd web && pnpm dev   # Vite dev server against the running service
```

The backend is Go (`internal/`), the frontend TypeScript with Vite and [Milkdown](https://milkdown.dev) (`web/`), embedded in the binary at build time. See [plan.md](plan.md) for the design.
