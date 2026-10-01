import type { Recent } from '../api'
import { groupBy, type LogicalFile } from './copies'
import { dirName, fileLink, fileName, h, timeAgo } from './dom'

// The recent lists and every markdown file, grouped by project. A file
// checked out in several worktrees is listed once and opens the copy that
// was changed last.
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
      this.list(viewed.map((path) => this.entry(path, [path]))),
      h('h2', {}, 'Recently modified'),
      this.list(modified.map((f) => this.entry(f.path, [f.path], f.path, h('time', { datetime: f.mtime }, timeAgo(f.mtime))))),
    )
    this.highlight()
  }

  renderTree(files: LogicalFile[]) {
    const byProject = groupBy(files, (f) => f.project)
    const projects = [...byProject.keys()].sort((a, b) => a.localeCompare(b))
    this.treeEl.replaceChildren(
      ...projects.map((project) => {
        const entries = byProject.get(project)!.sort((a, b) => a.rel.localeCompare(b.rel))
        return h(
          'details',
          { 'data-project': project },
          h('summary', {}, h('span', {}, project || '~/code'), h('span', { class: 'count' }, String(entries.length))),
          this.list(
            entries.map((f) =>
              this.entry(
                f.preferred.path,
                f.copies.map((c) => c.path),
                f.rel,
                f.copies.length > 1 ? h('span', { class: f.changed ? 'copies changed' : 'copies', title: copiesTitle(f) }, `×${f.copies.length}`) : undefined,
              ),
            ),
          ),
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
    for (const link of document.querySelectorAll<HTMLElement>('#sidebar a[data-paths]')) {
      const paths = link.dataset.paths!.split('\n')
      link.classList.toggle('current', this.current !== undefined && paths.includes(this.current))
    }
    const link = this.treeEl.querySelector<HTMLElement>('a.current')
    const group = link?.closest('details')
    if (group && !group.open) group.open = true
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
