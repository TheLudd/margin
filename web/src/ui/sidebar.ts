import type { FileEntry, Recent } from '../api'
import { dirName, fileLink, fileName, h, timeAgo } from './dom'

// The recent lists and every markdown file, grouped by repository.
export class Sidebar {
  private readonly recentEl = h('div', { class: 'recent' })
  private readonly treeEl = h('div', { class: 'tree' })
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
      this.list(viewed.map((path) => this.entry(path))),
      h('h2', {}, 'Recently modified'),
      this.list(modified.map((f) => this.entry(f.path, h('time', { datetime: f.mtime }, timeAgo(f.mtime))))),
    )
    this.highlight()
  }

  renderTree(files: FileEntry[]) {
    const byRepo = Map.groupBy(files, (f) => f.repo)
    const repos = [...byRepo.keys()].sort((a, b) => a.localeCompare(b))
    this.treeEl.replaceChildren(
      ...repos.map((repo) => {
        const entries = byRepo.get(repo)!
        const prefix = repo === '' ? '' : repo + '/'
        return h(
          'details',
          { 'data-repo': repo },
          h('summary', {}, h('span', {}, repo || '~/code'), h('span', { class: 'count' }, String(entries.length))),
          this.list(entries.map((f) => this.entry(f.path, undefined, f.path.slice(prefix.length)))),
        )
      }),
    )
    this.highlight()
  }

  setCurrent(path: string | undefined) {
    this.current = path
    this.highlight()
  }

  private highlight() {
    for (const link of document.querySelectorAll<HTMLElement>('#sidebar a[data-path]')) {
      link.classList.toggle('current', link.dataset.path === this.current)
    }
    const link = this.treeEl.querySelector<HTMLElement>('a.current')
    const group = link?.closest('details')
    if (group && !group.open) group.open = true
  }

  private list(items: HTMLElement[]) {
    if (items.length === 0) return h('p', { class: 'empty' }, 'Nothing yet')
    return h('ul', {}, ...items.map((item) => h('li', {}, item)))
  }

  private entry(path: string, extra?: HTMLElement, label = path) {
    return fileLink(
      path,
      this.open,
      h('span', { class: 'dir' }, dirName(label)),
      h('span', { class: 'name' }, fileName(label)),
      extra,
    )
  }
}
