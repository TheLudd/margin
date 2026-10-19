// The setup and settings screens (C): roots with suggestions and path
// completion, exclude patterns, file types, the day counts, errors and
// where the config is stored.
import { el } from './shell'
import type { Config, ConfigRoot, ConfigType, SettingsView, Suggestion, TypeColor, TypeSuggestion } from './types'

export const TYPE_COLORS: TypeColor[] = ['cyan', 'magenta', 'green', 'amber', 'blue', 'red', 'orange', 'yellow', 'violet', 'grey']

/** Glyphs offered for a mark (F-07): one character each, with a name. */
export const GLYPHS: [string, string][] = [
  ['✦', 'star'],
  ['✧', 'hollow star'],
  ['★', 'solid star'],
  ['◆', 'diamond'],
  ['◇', 'hollow diamond'],
  ['◈', 'framed diamond'],
  ['●', 'dot'],
  ['○', 'ring'],
  ['◉', 'target'],
  ['■', 'square'],
  ['□', 'hollow square'],
  ['▲', 'triangle'],
  ['▼', 'down triangle'],
  ['⬢', 'hexagon'],
  ['⬡', 'hollow hexagon'],
  ['⚑', 'flag'],
  ['✓', 'check'],
  ['✗', 'cross'],
  ['✎', 'pencil'],
  ['⚙', 'gear'],
  ['⚡', 'bolt'],
  ['☰', 'lines'],
  ['⌘', 'command'],
  ['λ', 'lambda'],
  ['§', 'section'],
  ['¶', 'pilcrow'],
  ['∞', 'infinity'],
  ['※', 'reference'],
]

export interface SettingsActions {
  save(config: Config): Promise<void>
  complete(typed: string): Promise<string[]>
  loadSuggestions(): Promise<Suggestion[]>
  loadTypeSuggestions(): Promise<TypeSuggestion[]>
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

interface TypeRow {
  name: HTMLInputElement
  match: HTMLInputElement
  mark: HTMLInputElement
  color: HTMLInputElement
  swatches: HTMLElement
  remove: HTMLButtonElement
  row: HTMLElement
  setColor(color: string): void
}

export interface SettingsRefs {
  form: HTMLFormElement
  rootsBody: HTMLElement
  suggestions: HTMLElement
  error: HTMLElement
  typeSuggestions: HTMLElement
  saveButton: HTMLButtonElement
  rows: RootRow[]
  typeRows: TypeRow[]
  config(): Config
  addRoot(root: ConfigRoot, nameEdited?: boolean): RootRow
  addType(type: ConfigType): TypeRow
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

  form.append(el('h2', { text: 'Types' }))
  form.append(
    el('p', {
      text: 'Files whose name says little, like every CLAUDE.md. A file matching the pattern is marked and named by the part of its path the pattern leaves open: with .claude/skills/*/SKILL.md the skill folder is the name. The mark is the name unless given, a word or one character: the mark field offers glyphs, and any character can be pasted. The mark is coloured from the palette in turn unless chosen.',
    }),
  )
  const typesHead = el('div', { class: 'types-head' }, el('span', { text: 'Name' }), el('span', { text: 'Pattern' }), el('span', { text: 'Mark' }), el('span', { text: 'Colour' }), el('span'))
  const typesBody = el('div', { class: 'types' })
  form.append(typesHead, typesBody)
  const typeRows: TypeRow[] = []
  const addType = (type: ConfigType): TypeRow => {
    const name = el('input', { type: 'text', name: 'typeName', placeholder: 'claude', 'aria-label': 'Type name', autocomplete: 'off' })
    name.value = type.name
    const match = el('input', { type: 'text', name: 'typeMatch', placeholder: 'CLAUDE.md', 'aria-label': 'Type pattern', autocomplete: 'off' })
    match.value = type.match
    const glyphs = el('datalist', { id: `glyphs-${++completionId}` }, ...GLYPHS.map(([g, label]) => el('option', { value: g, label })))
    const mark = el('input', { type: 'text', name: 'typeMark', placeholder: 'mark', 'aria-label': 'Type mark', autocomplete: 'off', list: glyphs.id })
    mark.value = type.mark ?? ''
    const color = el('input', { type: 'hidden', name: 'typeColor' })
    const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Type colour' })
    const setColor = (c: string) => {
      color.value = c
      for (const b of swatches.children) b.setAttribute('aria-checked', b.getAttribute('data-color') === c ? 'true' : 'false')
    }
    for (const c of ['', ...TYPE_COLORS]) {
      const b = el('button', { class: 'swatch', type: 'button', role: 'radio', 'data-color': c, 'aria-label': c || 'in turn', title: c || 'in turn' })
      b.addEventListener('click', () => setColor(c))
      swatches.append(b)
    }
    setColor(type.color ?? '')
    const remove = el('button', { class: 'remove', type: 'button', 'aria-label': `Remove type ${type.name || ''}`.trim(), title: 'Remove', text: '×' })
    const row = el('div', { class: 'type' }, name, match, mark, swatches, remove, color, glyphs)
    const r: TypeRow = { name, match, mark, color, swatches, remove, row, setColor }
    remove.addEventListener('click', () => {
      typeRows.splice(typeRows.indexOf(r), 1)
      row.remove()
    })
    typeRows.push(r)
    typesBody.append(row)
    return r
  }
  for (const t of view.config.types) addType(t)
  const addTypeButton = el('button', { class: 'add', type: 'button', text: '+ add a type' })
  addTypeButton.addEventListener('click', () => {
    addType({ name: '', match: '' }).name.focus()
  })
  form.append(el('div', { class: 'actions' }, addTypeButton))

  // Suggested types (F-08): the recurring file names no type covers.
  const typeSuggestions = el('div', { class: 'type-suggestions' })
  if (!setup) {
    typeSuggestions.append(el('div', { class: 'loading' }, el('span', { class: 'spinner' }), el('span', { text: 'Looking for recurring file names…' })))
    form.append(typeSuggestions)
    actions.loadTypeSuggestions().then((list) => {
      typeSuggestions.replaceChildren()
      const shown = list.filter((s) => !typeRows.some((r) => r.match.value.trim().toLowerCase() === s.match.toLowerCase()))
      const none = () => typeSuggestions.replaceChildren(el('p', { class: 'none', text: 'No recurring file names without a type.' }))
      if (shown.length === 0) {
        none()
        return
      }
      typeSuggestions.append(el('p', { class: 'hint', text: 'File names found in several places:' }))
      for (const s of shown) {
        const add = el('button', { class: 'add plus', type: 'button', 'aria-label': `Add type ${s.name}`, title: 'Add', text: '+' })
        const row = el('div', { class: 'type-suggestion' }, el('span', { class: 'pattern', text: s.match }), el('span', { class: 'files', text: String(s.count) }), add)
        add.addEventListener('click', () => {
          addType({ name: s.name, match: s.match })
          row.remove()
          if (!typeSuggestions.querySelector('.type-suggestion')) none()
        })
        typeSuggestions.append(row)
      }
    })
  }

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
    types: typeRows.map((r) => {
      const t: ConfigType = { name: r.name.value.trim(), match: r.match.value.trim() }
      const mark = r.mark.value.trim()
      if (mark) t.mark = mark
      if (r.color.value) t.color = r.color.value as TypeColor
      return t
    }),
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
  return { form, rootsBody, suggestions, error, typeSuggestions, saveButton, rows, typeRows, config, addRoot, addType }
}

function formatCount(n: number | undefined): string {
  return n === undefined ? '' : String(n)
}
