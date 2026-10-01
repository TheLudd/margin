import { dirName, fileName, h } from './dom'
import { fuzzyFilter } from './fuzzy'

const limit = 50

export interface FinderItem {
  label: string // what is shown and matched
  path: string // what is opened
}

// Ctrl+K / Ctrl+P: jump to any file by fuzzy path. With an empty query the
// recently viewed files come first.
export class Finder {
  private readonly dialog = h('dialog', { id: 'finder' })
  private readonly input = h('input', { type: 'text', placeholder: 'Open file…', spellcheck: 'false' })
  private readonly list = h('ul')
  private results: FinderItem[] = []
  private selected = 0

  constructor(
    private readonly files: () => FinderItem[],
    private readonly recent: () => FinderItem[],
    private readonly open: (path: string) => void,
  ) {
    this.dialog.append(this.input, this.list)
    document.body.append(this.dialog)
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', (event) => this.key(event))
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close()
    })
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'p')) {
        event.preventDefault()
        this.show()
      }
    })
  }

  show() {
    this.input.value = ''
    this.search()
    this.dialog.showModal()
    this.input.focus()
  }

  private search() {
    const query = this.input.value
    const files = this.files()
    if (query.trim() === '') {
      const recent = this.recent()
      const seen = new Set(recent.map((r) => r.path))
      this.results = [...recent, ...files.filter((f) => !seen.has(f.path))].slice(0, limit)
    } else {
      this.results = fuzzyFilter(query, files, (f) => f.label, limit)
    }
    this.selected = 0
    this.render()
  }

  private render() {
    this.list.replaceChildren(
      ...this.results.map((result, i) => {
        const item = h(
          'li',
          { class: i === this.selected ? 'selected' : undefined },
          h('span', { class: 'name' }, fileName(result.label)),
          h('span', { class: 'dir' }, dirName(result.label)),
        )
        item.addEventListener('mousedown', (event) => {
          event.preventDefault()
          this.choose(result.path)
        })
        return item
      }),
    )
    this.list.children[this.selected]?.scrollIntoView({ block: 'nearest' })
  }

  private key(event: KeyboardEvent) {
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (move) {
      event.preventDefault()
      this.selected = Math.max(0, Math.min(this.results.length - 1, this.selected + move))
      this.render()
    } else if (event.key === 'Enter' && this.results[this.selected]) {
      event.preventDefault()
      this.choose(this.results[this.selected].path)
    }
  }

  private choose(path: string) {
    this.dialog.close()
    this.open(path)
  }
}
