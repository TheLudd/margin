import type { Recent } from '../api'
import { groupBy, isActive, type LogicalFile } from './copies'
import { dirName, fileLink, fileName, h, timeAgo } from './dom'

// The recent lists and every markdown file, grouped by project. Files
// viewed or modified in the last 14 days are listed; the rest are folded
// under "Older". A file checked out in several worktrees is listed once and
// opens the copy that was changed last.
export class Sidebar {
  private readonly recentEl = h('div', { class: 'recent' })
  private readonly treeEl = h('div', { class: 'tree' })
  private readonly open_ = new Map<string, boolean>() // fold state by group key
  private current?: string

  constructor(
    root: HTMLElement,
    private readonly open: (path: string) => void,
  ) {
    root.append(this.recentEl, h('h2', {}, 'Files'), this.treeEl)
  }

  renderRecent({ viewed, modified }: Recent) {
    this.recentEl.replaceChildren(
      h('h2', {}, 'Recently viewed'),
      this.list(viewed.map((path) => this.entry(path, [path]))),
      h('h2', {}, 'Recently modified'),
      this.list(modified.map((f) => this.entry(f.path, [f.path], f.path, h('time', { datetime: f.mtime }, timeAgo(f.mtime))))),
    )
    this.highlight()
  }

  renderTree(files: LogicalFile[], now = Date.now()) {
    const active = files.filter((f) => isActive(f, now))
    const older = files.filter((f) => !isActive(f, now))
    const latest = (group: LogicalFile[]) => Math.max(...group.map((f) => f.activeAt))
    const byRecency = (a: [string, LogicalFile[]], b: [string, LogicalFile[]]) => latest(b[1]) - latest(a[1])
    const byName = (a: [string, LogicalFile[]], b: [string, LogicalFile[]]) => a[0].localeCompare(b[0])

    this.treeEl.replaceChildren(
      ...(active.length ? this.projects('active', active, byRecency, true) : [h('p', { class: 'empty' }, 'Nothing in the last 14 days')]),
      this.group('older', h('span', {}, 'Older'), String(older.length), false, this.projects('older', older, byName, false)),
    )
    this.highlight()
  }

  private projects(
    section: string,
    files: LogicalFile[],
    order: (a: [string, LogicalFile[]], b: [string, LogicalFile[]]) => number,
    openByDefault: boolean,
  ): HTMLElement[] {
    return [...groupBy(files, (f) => f.project)].sort(order).map(([project, entries]) =>
      this.group(
        `${section}:${project}`,
        h('span', {}, project || '~/code'),
        String(entries.length),
        openByDefault,
        [this.list(entries.sort((a, b) => a.rel.localeCompare(b.rel)).map((f) => this.fileEntry(f)))],
      ),
    )
  }

  // A foldable group that keeps its fold state across re-renders.
  private group(key: string, label: HTMLElement, count: string, openByDefault: boolean, children: HTMLElement[]) {
    const details = h('details', { 'data-key': key, open: this.open_.get(key) ?? openByDefault }, h('summary', {}, label, h('span', { class: 'count' }, count)), ...children)
    details.addEventListener('toggle', () => this.open_.set(key, details.open))
    return details
  }

  private fileEntry(f: LogicalFile) {
    return this.entry(
      f.preferred.path,
      f.copies.map((c) => c.path),
      f.rel,
      f.copies.length > 1 ? h('span', { class: f.changed ? 'copies changed' : 'copies', title: copiesTitle(f) }, `×${f.copies.length}`) : undefined,
    )
  }

  setCurrent(path: string | undefined) {
    this.current = path
    this.highlight()
  }

  private highlight() {
    for (const link of document.querySelectorAll<HTMLElement>('#sidebar a[data-paths]')) {
      const paths = link.dataset.paths!.split('\n')
      link.classList.toggle('current', this.current !== undefined && paths.includes(this.current))
    }
    // Unfold the groups around the open file, without overriding a fold the
    // user chose for other files.
    for (let group = this.treeEl.querySelector('a.current')?.closest('details'); group; group = group.parentElement?.closest('details')) {
      group.open = true
    }
  }

  private list(items: HTMLElement[]) {
    if (items.length === 0) return h('p', { class: 'empty' }, 'Nothing yet')
    return h('ul', {}, ...items.map((item) => h('li', {}, item)))
  }

  // A link opening path, highlighted while any of paths is open.
  private entry(path: string, paths: string[], label = path, extra?: HTMLElement) {
    const link = fileLink(path, this.open, h('span', { class: 'dir' }, dirName(label)), h('span', { class: 'name' }, fileName(label)), extra)
    link.dataset.paths = paths.join('\n')
    return link
  }
}

function copiesTitle(f: LogicalFile) {
  return f.changed ? `In ${f.copies.length} worktrees, changed in some` : `In ${f.copies.length} worktrees, all unchanged`
}
