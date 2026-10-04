import { type Folder, type RootSettings, saveSettings, type Settings, suggestDirs } from '../api'
import { debounce } from '../sync'
import { BusyOverlay } from './busy-overlay'
import { fileName, h } from './dom'
import { fileCount, FolderSuggestions } from './folder-suggestions'

export type SettingsMode = 'setup' | 'settings'

const baseName = (path: string) => fileName(path.replace(/\/+$/, ''))

// Edits the folders margin serves. In setup mode it is the first screen,
// shown while no folder is configured.
export class SettingsView {
  private readonly section = h('section', { class: 'settings' })
  private readonly rowsEl = h('div', { class: 'roots' })
  private readonly exclude = h('textarea', { rows: '4', spellcheck: 'false', placeholder: 'CHANGELOG.md\n*.draft.md' })
  private readonly activeDays = h('input', { type: 'number', min: '1', max: '365', class: 'days' })
  private readonly unreadDays = h('input', { type: 'number', min: '1', max: '365', class: 'days' })
  private readonly errorEl = h('p', { class: 'error', hidden: true })
  private readonly saveButton = h('button', { class: 'primary', type: 'button' })
  private readonly busy = new BusyOverlay()
  private readonly suggestions = new FolderSuggestions((folder) => this.addSuggested(folder))
  private rows: Row[] = []

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
    this.saveButton.textContent = mode === 'setup' ? 'Start' : 'Save'

    this.section.replaceChildren(
      ...(mode === 'setup'
        ? [h('h1', {}, 'Welcome to margin'), h('p', {}, 'Which folders should margin serve? Every markdown file in them can be read and edited here.')]
        : [h('h1', {}, 'Settings'), h('p', {}, 'The folders margin serves. Each name is the first part of every path in it.')]),
      h('h2', {}, 'Folders'),
      h('div', { class: 'roots-head' }, h('span', {}, 'Name'), h('span', {}, 'Folder'), h('span', {}, 'Files')),
      this.rowsEl,
      h('div', { class: 'actions' }, add),
      h('h2', {}, 'Suggested'),
      h('p', {}, 'Folders in your home that hold markdown.'),
      this.suggestions.element,
      h('h2', {}, 'Hidden files'),
      h(
        'p',
        {},
        'Files to leave out of the sidebar, search and recent activity, one pattern per line. A pattern without a slash matches file names anywhere, such as CHANGELOG.md or *.draft.md; one with a slash matches the end of a path, such as generated/*.md. Case is ignored.',
      ),
      this.exclude,
      h('h2', {}, 'Recent files'),
      h('p', { class: 'inline' }, 'List files viewed or modified in the last ', this.activeDays, ' days under Recent. Others are under Older.'),
      h('h2', {}, 'Unread changes'),
      h(
        'p',
        { class: 'inline' },
        'Show the changes made since a file was last read for ',
        this.unreadDays,
        " days after reading it, even when the file is gone for a while, as after switching branches. After that, its current version counts as read.",
      ),
      h('div', { class: 'actions save' }, this.saveButton),
      this.errorEl,
      h('p', { class: 'file' }, `Stored in ${settings.file}`),
    )
    this.exclude.value = settings.exclude.join('\n')
    this.activeDays.value = String(settings.activeDays)
    this.unreadDays.value = String(settings.unreadDays)
    this.rowsEl.replaceChildren()
    this.rows = []
    const roots = settings.roots.length ? settings.roots : [{ name: '', path: '' }]
    for (const root of roots) this.addRow(root)
    this.suggestions.load()
    this.showError(settings.error ? `The config file could not be used: ${settings.error}` : '')
    if (mode === 'setup') this.rows[0]?.focus()
  }

  private addRow(root: RootSettings, files = root.files === undefined ? '' : String(root.files)): Row {
    const row = new Row(
      root,
      files,
      () => {
        this.rows = this.rows.filter((r) => r !== row)
        row.element.remove()
        this.excludeServed()
      },
      () => this.excludeServed(),
    )
    this.rows.push(row)
    this.rowsEl.append(row.element)
    this.excludeServed()
    return row
  }

  // Adds a suggested folder in place of any blank rows.
  private addSuggested(folder: Folder) {
    for (const row of this.rows.filter((r) => r.isBlank())) row.element.remove()
    this.rows = this.rows.filter((r) => !r.isBlank())
    this.addRow({ name: baseName(folder.path), path: folder.path }, fileCount(folder))
  }

  private excludeServed() {
    this.suggestions.exclude(this.rows.map((r) => r.value().path))
  }

  private async save() {
    const roots = this.rows.map((r) => r.value()).filter((r) => r.name || r.path)
    this.saveButton.disabled = true
    try {
      const exclude = this.exclude.value.split('\n').map((line) => line.trim()).filter(Boolean)
      const result = await this.busy.during('Indexing…', saveSettings(roots, exclude, Number(this.activeDays.value), Number(this.unreadDays.value)))
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

  constructor(root: RootSettings, files: string, remove: () => void, changed: () => void) {
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
      changed()
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
      h('span', { class: 'files' }, files),
      removeButton,
    )
  }

  value(): RootSettings {
    return { name: this.name.value.trim(), path: this.path.value.trim().replace(/(.)\/+$/, '$1') }
  }

  isBlank(): boolean {
    const { name, path } = this.value()
    return name === '' && path === ''
  }

  focus() {
    this.path.focus()
  }
}
