import { dirName, fileName, h } from './dom'
import { fuzzyFilter } from './fuzzy'

const limit = 50

// Ctrl+K / Ctrl+P: jump to any file by fuzzy path. With an empty query the
// recently viewed files come first.
export class Finder {
  private readonly dialog = h('dialog', { id: 'finder' })
  private readonly input = h('input', { type: 'text', placeholder: 'Open file…', spellcheck: 'false' })
  private readonly list = h('ul')
  private results: string[] = []
  private selected = 0

  constructor(
    private readonly files: () => string[],
    private readonly recent: () => string[],
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
      const recent = this.recent().filter((p) => files.includes(p))
      this.results = [...recent, ...files.filter((p) => !recent.includes(p))].slice(0, limit)
    } else {
      this.results = fuzzyFilter(query, files, (p) => p, limit)
    }
    this.selected = 0
    this.render()
  }

  private render() {
    this.list.replaceChildren(
      ...this.results.map((path, i) => {
        const item = h(
          'li',
          { class: i === this.selected ? 'selected' : undefined },
          h('span', { class: 'name' }, fileName(path)),
          h('span', { class: 'dir' }, dirName(path)),
        )
        item.addEventListener('mousedown', (event) => {
          event.preventDefault()
          this.choose(path)
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
      this.choose(this.results[this.selected])
    }
  }

  private choose(path: string) {
    this.dialog.close()
    this.open(path)
  }
}
