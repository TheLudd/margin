import { dirName, fileName, h } from './dom'
import { fuzzyFilter } from './fuzzy'

const limit = 30
const olderLimit = 20

interface Section {
  title: string
  items: FinderItem[]
}

export interface FinderItem {
  label: string // what is shown and matched
  path: string // what is opened
}

// Ctrl+K / Ctrl+P: jump to any file by path. With an empty query it lists
// recent activity. Matches among active files come first; matches among
// older files follow in their own section.
export class Finder {
  private readonly dialog = h('dialog', { id: 'finder' })
  private readonly input = h('input', { type: 'text', placeholder: 'Open file…', spellcheck: 'false' })
  private readonly list = h('ul')
  private sections: Section[] = []
  private results: FinderItem[] = [] // all sections' items, in order
  private selected = 0

  constructor(
    private readonly files: () => FinderItem[],
    private readonly olderFiles: () => FinderItem[],
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
    if (query.trim() === '') {
      this.sections = [{ title: 'Recent activity', items: this.recent() }]
    } else {
      this.sections = [
        { title: 'Active', items: fuzzyFilter(query, this.files(), (f) => f.label, limit) },
        { title: 'Older', items: fuzzyFilter(query, this.olderFiles(), (f) => f.label, olderLimit) },
      ]
    }
    this.results = this.sections.flatMap((section) => section.items)
    this.selected = 0
    this.render()
  }

  private render() {
    let index = 0
    const items = this.sections
      .filter((section) => section.items.length > 0)
      .flatMap((section) => [
        h('li', { class: `tier ${section.title.toLowerCase()}` }, section.title),
        ...section.items.map((result) => this.item(result, index++, section.title === 'Older')),
      ])
    this.list.replaceChildren(...(items.length ? items : [h('li', { class: 'tier' }, 'No matches')]))
    this.list.querySelector('li.selected')?.scrollIntoView({ block: 'nearest' })
  }

  private item(result: FinderItem, index: number, older: boolean) {
    const classes = [index === this.selected && 'selected', older && 'older'].filter(Boolean).join(' ')
    const item = h('li', { class: classes || undefined }, h('span', { class: 'name' }, fileName(result.label)), h('span', { class: 'dir' }, dirName(result.label)))
    item.addEventListener('mousedown', (event) => {
      event.preventDefault()
      this.choose(result.path)
    })
    return item
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
