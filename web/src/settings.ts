// The setup and settings screens (C): roots with suggestions and path
// completion, exclude patterns, the day counts, errors and where the config
// is stored.
import { el } from './shell'
import type { Config, ConfigRoot, SettingsView, Suggestion } from './types'

export interface SettingsActions {
  save(config: Config): Promise<void>
  complete(typed: string): Promise<string[]>
  loadSuggestions(): Promise<Suggestion[]>
}

export interface SettingsOptions {
  view: SettingsView
  /** Files per root name, shown in the roots grid. */
  counts: Record<string, number>
  actions: SettingsActions
}

/** The name a folder suggests: its base name (C-06). */
export function nameForFolder(folder: string): string {
  const trimmed = folder.replace(/\/+$/, '')
  const base = trimmed.split('/').pop() ?? ''
  return base === '~' ? 'home' : base
}

interface RootRow {
  name: HTMLInputElement
  folder: HTMLInputElement
  files: HTMLElement
  remove: HTMLButtonElement
  row: HTMLElement
  nameEdited: boolean
}

export interface SettingsRefs {
  form: HTMLFormElement
  rootsBody: HTMLElement
  suggestions: HTMLElement
  error: HTMLElement
  saveButton: HTMLButtonElement
  rows: RootRow[]
  config(): Config
  addRoot(root: ConfigRoot, nameEdited?: boolean): RootRow
}

let completionId = 0

/** Renders the settings screen; with no roots it is the setup screen (C-04). */
export function renderSettings(container: HTMLElement, opts: SettingsOptions): SettingsRefs {
  const { view, actions } = opts
  const setup = view.config.roots.length === 0
  container.replaceChildren()
  container.append(el('h1', { text: setup ? 'Welcome to margin' : 'Settings' }))
  container.append(
    el('p', {
      text: setup
        ? 'margin reads the markdown files in the folders you choose. Pick one or more to start.'
        : 'The folders margin serves, what it leaves out, and how long files stay recent.',
    }),
  )
  const error = el('div', { class: 'error', role: 'alert' })
  error.hidden = !view.error
  error.textContent = view.error
  container.append(error)

  const form = el('form', { class: 'settings-form' })
  form.addEventListener('submit', (ev) => ev.preventDefault())
  container.append(form)

  form.append(el('h2', { text: 'Folders' }))
  const rootsHead = el('div', { class: 'roots-head' }, el('span', { text: 'Name' }), el('span', { text: 'Folder' }), el('span', { text: 'Files' }), el('span'))
  const rootsBody = el('div', { class: 'roots' })
  form.append(rootsHead, rootsBody)
  const rows: RootRow[] = []

  const addRoot = (root: ConfigRoot, nameEdited = true): RootRow => {
    const name = el('input', { type: 'text', name: 'name', placeholder: 'name', 'aria-label': 'Name', autocomplete: 'off' })
    name.value = root.name
    const list = el('datalist', { id: `folder-completions-${++completionId}` })
    const folder = el('input', { type: 'text', name: 'folder', placeholder: '~/folder', 'aria-label': 'Folder', autocomplete: 'off', list: list.id })
    folder.value = root.path
    const files = el('span', { class: 'files', text: formatCount(opts.counts[root.name]) })
    const remove = el('button', { class: 'remove', type: 'button', 'aria-label': `Remove ${root.name || 'root'}`, title: 'Remove', text: '×' })
    const row = el('div', { class: 'root' }, name, folder, files, remove, list)
    const r: RootRow = { name, folder, files, remove, row, nameEdited }
    name.addEventListener('input', () => {
      r.nameEdited = true
    })
    let pending = 0
    folder.addEventListener('input', () => {
      if (!r.nameEdited) name.value = nameForFolder(folder.value)
      const typed = folder.value
      const id = ++pending
      actions.complete(typed).then((options) => {
        if (id !== pending) return
        list.replaceChildren(...options.map((o) => el('option', { value: o })))
      })
    })
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(r), 1)
      row.remove()
    })
    rows.push(r)
    rootsBody.append(row)
    return r
  }
  for (const r of view.config.roots) addRoot(r)

  const addButton = el('button', { class: 'add', type: 'button', text: '+ add a folder' })
  addButton.addEventListener('click', () => {
    const r = addRoot({ name: '', path: '' }, false)
    r.folder.focus()
  })
  form.append(el('div', { class: 'actions' }, addButton))

  form.append(el('h2', { text: 'Suggested' }))
  const suggestions = el('div', { class: 'suggestions' })
  suggestions.append(el('div', { class: 'loading' }, el('span', { class: 'spinner' }), el('span', { text: 'Looking for folders with markdown…' })))
  form.append(suggestions)
  actions.loadSuggestions().then((list) => {
    suggestions.replaceChildren()
    const served = () => new Set(rows.map((r) => r.folder.value.replace(/\/+$/, '')))
    const shown = list.filter((s) => !served().has(s.path))
    if (shown.length === 0) {
      suggestions.append(el('p', { class: 'none', text: 'No other folders with markdown found in your home.' }))
      return
    }
    for (const s of shown) {
      const add = el('button', { class: 'add plus', type: 'button', 'aria-label': `Add ${s.path}`, title: 'Add', text: '+' })
      const count = el('span', { class: 'files', text: `${s.partial ? '≥' : ''}${s.count}` })
      const row = el('div', { class: 'suggestion' }, el('span', { class: 'path', text: s.path }), count, add)
      add.addEventListener('click', () => {
        addRoot({ name: nameForFolder(s.path), path: s.path }, false)
        row.remove()
      })
      suggestions.append(row)
    }
  })

  let exclude: HTMLTextAreaElement | null = null
  let activeDays: HTMLInputElement | null = null
  let unreadDays: HTMLInputElement | null = null
  form.append(el('h2', { text: 'Leave out' }))
  exclude = el('textarea', { name: 'exclude', rows: '3', 'aria-label': 'Exclude patterns', placeholder: 'CHANGELOG.md\ngenerated/*.md' })
  exclude.value = view.config.exclude.join('\n')
  form.append(el('p', { text: 'One pattern per line. Without a slash it matches file names anywhere; with one, the end of a path. Case is ignored. Files left out still open by their address.' }), exclude)

  form.append(el('h2', { text: 'Windows' }))
  activeDays = el('input', { class: 'days', type: 'number', name: 'activeDays', min: '1', max: '365', 'aria-label': 'Active days' })
  activeDays.value = String(view.config.activeDays)
  unreadDays = el('input', { class: 'days', type: 'number', name: 'unreadDays', min: '1', max: '365', 'aria-label': 'Unread days' })
  unreadDays.value = String(view.config.unreadDays)
  form.append(
    el('p', {}, 'Recent holds files viewed or modified in the last ', activeDays, ' days.'),
    el('p', {}, 'Unread changes are kept for ', unreadDays, ' days after a file was last read.'),
  )

  const saveButton = el('button', { class: 'primary', type: 'submit', text: setup ? 'Start' : 'Save' })
  form.append(el('div', { class: 'actions save' }, saveButton))

  const config = (): Config => ({
    roots: rows.map((r) => ({ name: r.name.value.trim(), path: r.folder.value.trim() })),
    exclude: (exclude?.value ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    activeDays: Number(activeDays?.value ?? 14),
    unreadDays: Number(unreadDays?.value ?? 30),
  })

  form.addEventListener('submit', async () => {
    saveButton.disabled = true
    error.hidden = true
    try {
      await actions.save(config())
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err)
      error.hidden = false
    } finally {
      saveButton.disabled = false
    }
  })

  container.append(el('p', { class: 'file' }, 'Stored in ', el('code', { text: view.file })))
  return { form, rootsBody, suggestions, error, saveButton, rows, config, addRoot }
}

function formatCount(n: number | undefined): string {
  return n === undefined ? '' : String(n)
}
