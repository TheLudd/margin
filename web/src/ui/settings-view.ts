import { type RootSettings, saveSettings, type Settings, suggestDirs } from '../api'
import { debounce } from '../sync'
import { h } from './dom'

export type SettingsMode = 'setup' | 'settings'

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? ''

// Edits the folders margin serves. In setup mode it is the first screen,
// shown while no folder is configured.
export class SettingsView {
  private readonly section = h('section', { class: 'settings' })
  private readonly rowsEl = h('div', { class: 'roots' })
  private readonly errorEl = h('p', { class: 'error', hidden: true })
  private readonly saveButton = h('button', { class: 'primary', type: 'button' })
  private rows: Row[] = []
  private saveLabel = 'Save'

  constructor(
    main: HTMLElement,
    private readonly saved: (settings: Settings) => void,
  ) {
    main.append(this.section)
    this.saveButton.addEventListener('click', () => this.save())
  }

  show(mode: SettingsMode, settings: Settings) {
    const add = h('button', { type: 'button' }, '+ Add folder')
    add.addEventListener('click', () => this.addRow({ name: '', path: '' }).focus())
    this.saveLabel = mode === 'setup' ? 'Start' : 'Save'
    this.saveButton.textContent = this.saveLabel

    this.section.replaceChildren(
      ...(mode === 'setup'
        ? [h('h1', {}, 'Welcome to margin'), h('p', {}, 'Which folders should margin serve? Every markdown file in them can be read and edited here.')]
        : [h('h1', {}, 'Settings'), h('p', {}, 'The folders margin serves. Each name is the first part of every path in it.')]),
      h('div', { class: 'roots-head' }, h('span', {}, 'Name'), h('span', {}, 'Folder'), h('span', {}, 'Files')),
      this.rowsEl,
      h('div', { class: 'actions' }, add, this.saveButton),
      this.errorEl,
      h('p', { class: 'file' }, `Stored in ${settings.file}`),
    )
    this.rowsEl.replaceChildren()
    this.rows = []
    const roots = settings.roots.length ? settings.roots : [{ name: '', path: '' }]
    for (const root of roots) this.addRow(root)
    this.showError(settings.error ? `The config file could not be used: ${settings.error}` : '')
    if (mode === 'setup') this.rows[0]?.focus()
  }

  private addRow(root: RootSettings): Row {
    const row = new Row(root, () => {
      this.rows = this.rows.filter((r) => r !== row)
      row.element.remove()
    })
    this.rows.push(row)
    this.rowsEl.append(row.element)
    return row
  }

  private async save() {
    const roots = this.rows.map((r) => r.value()).filter((r) => r.name || r.path)
    this.saveButton.disabled = true
    this.saveButton.textContent = 'Indexing…'
    try {
      const result = await saveSettings(roots)
      if (result.kind === 'invalid') {
        this.showError(result.message)
        return
      }
      this.showError('')
      this.saved(result.settings)
    } catch (error) {
      this.showError((error as Error).message)
    } finally {
      this.saveButton.disabled = false
      this.saveButton.textContent = this.saveLabel
    }
  }

  private showError(message: string) {
    this.errorEl.textContent = message
    this.errorEl.hidden = message === ''
  }
}

let rowIds = 0

// One folder: its name, its path with completion, and its file count.
class Row {
  readonly element: HTMLElement
  private readonly name = h('input', { type: 'text', placeholder: 'code', spellcheck: 'false' })
  private readonly path = h('input', { type: 'text', placeholder: '~/code', spellcheck: 'false' })
  private autoName: boolean // the name follows the folder until edited

  constructor(root: RootSettings, remove: () => void) {
    const suggestions = h('datalist', { id: `folders-${++rowIds}` })
    this.path.setAttribute('list', suggestions.id)
    this.name.value = root.name
    this.path.value = root.path
    this.autoName = root.name === '' || root.name === baseName(root.path)

    const suggest = debounce(async () => {
      const dirs = await suggestDirs(this.path.value)
      suggestions.replaceChildren(...dirs.map((dir) => h('option', { value: dir + '/' })))
    }, 120)
    this.path.addEventListener('focus', suggest)
    this.path.addEventListener('input', () => {
      if (this.autoName) this.name.value = baseName(this.path.value)
      suggest()
    })
    this.name.addEventListener('input', () => (this.autoName = this.name.value === ''))

    const removeButton = h('button', { type: 'button', class: 'remove', title: 'Remove folder' }, '×')
    removeButton.addEventListener('click', remove)
    this.element = h(
      'div',
      { class: 'root' },
      this.name,
      this.path,
      suggestions,
      h('span', { class: 'files' }, root.files === undefined ? '' : String(root.files)),
      removeButton,
    )
  }

  value(): RootSettings {
    return { name: this.name.value.trim(), path: this.path.value.trim().replace(/(.)\/+$/, '$1') }
  }

  focus() {
    this.path.focus()
  }
}
