import type { Activity } from '../api'
import { groupBy, type LogicalFile } from './copies'
import { display } from './display'
import { dirName, fileLink, fileName, h, timeAgo } from './dom'

// Every markdown file, once: the ones viewed or modified within the active
// window under "Recent", latest first, and the rest under "Older", grouped by
// project. A file checked out in several worktrees is listed once and opens
// the copy that was changed last.
export class Sidebar {
  private readonly recentEl = h('div', { class: 'recent' })
  private readonly olderEl = h('div', { class: 'tree' })
  private readonly recentCount = h('span', { class: 'count' })
  private readonly olderCount = h('span', { class: 'count' })
  private readonly open_ = loadFolds() // fold state by group key
  private activity: Activity[] = []
  private files: LogicalFile[] = []
  private activeDays = 0
  private current?: string

  constructor(
    root: HTMLElement,
    private readonly open: (path: string) => void,
    private readonly forget: (path: string) => void,
  ) {
    root.append(
      this.group('section:recent', h('h2', {}, 'Recent'), this.recentCount, true, [this.recentEl], 'section'),
      this.group('section:older', h('h2', {}, 'Older'), this.olderCount, false, [this.olderEl], 'section'),
    )
  }

  // Shows activity, the files within an active window of activeDays.
  renderRecent(activity: Activity[], activeDays: number) {
    this.activity = activity
    this.activeDays = activeDays
    this.render()
  }

  renderTree(files: LogicalFile[]) {
    this.files = files
    this.render()
  }

  private render() {
    const recent = new Set(this.activity.map((a) => a.path))
    const older = this.files.filter((f) => !f.copies.some((c) => recent.has(c.path)))
    const byName = (a: [string, LogicalFile[]], b: [string, LogicalFile[]]) => a[0].localeCompare(b[0])

    this.recentEl.replaceChildren(
      this.activity.length
        ? this.list(this.activity.map((a) => this.recentEntry(a)))
        : h('p', { class: 'empty' }, `Nothing in the last ${this.activeDays} ${this.activeDays === 1 ? 'day' : 'days'}`),
    )
    this.olderEl.replaceChildren(...this.projects('older', older, byName, false))
    this.recentCount.textContent = String(this.activity.length)
    this.olderCount.textContent = String(older.length)
    this.highlight()
  }

  private recentEntry(a: Activity) {
    const time = h('time', { datetime: a.at, class: a.kind, title: a.kind === 'viewed' ? 'viewed' : 'modified' }, timeAgo(a.at))
    const remove = h('button', { type: 'button', class: 'forget', title: 'Remove from recent activity' }, '×')
    remove.addEventListener('click', () => this.forget(a.path))
    return h('div', { class: 'recent-entry' }, this.entry(a.path, [a.path], display(a.path), time), remove)
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
        h('span', {}, display(project) || project),
        h('span', { class: 'count' }, String(entries.length)),
        openByDefault,
        [this.list(entries.sort((a, b) => a.rel.localeCompare(b.rel)).map((f) => this.fileEntry(f)))],
      ),
    )
  }

  // A foldable group that keeps its fold state across re-renders and reloads.
  private group(key: string, label: HTMLElement, count: HTMLElement, openByDefault: boolean, children: HTMLElement[], className?: string) {
    const details = h(
      'details',
      { 'data-key': key, class: className, open: this.open_.get(key) ?? openByDefault },
      h('summary', {}, label, count),
      ...children,
    )
    details.addEventListener('toggle', () => {
      this.open_.set(key, details.open)
      saveFolds(this.open_)
    })
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
    let group = this.olderEl.querySelector('a.current')?.closest('details')
    for (; group; group = group.parentElement?.closest('details')) {
      group.open = true
    }
  }

  private list(items: HTMLElement[]) {
    if (items.length === 0) return h('p', { class: 'empty' }, 'Nothing yet')
    return h('ul', {}, ...items.map((item) => h('li', {}, item)))
  }

  // A link opening path, highlighted while any of paths is open.
  private entry(path: string, paths: string[], label = path, extra?: HTMLElement) {
    const text = h('span', { class: 'label' }, h('span', { class: 'dir' }, dirName(label)), h('span', { class: 'name' }, fileName(label)))
    const link = fileLink(path, this.open, text, extra)
    link.dataset.paths = paths.join('\n')
    return link
  }
}

const foldsKey = 'margin.folds'

// Fold state is a per-browser convenience; storage may be unavailable.
function loadFolds(): Map<string, boolean> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(foldsKey) ?? '{}')))
  } catch {
    return new Map()
  }
}

function saveFolds(folds: Map<string, boolean>) {
  try {
    localStorage.setItem(foldsKey, JSON.stringify(Object.fromEntries(folds)))
  } catch {
    // not persisted
  }
}

function copiesTitle(f: LogicalFile) {
  return f.changed ? `In ${f.copies.length} worktrees, changed in some` : `In ${f.copies.length} worktrees, all unchanged`
}
