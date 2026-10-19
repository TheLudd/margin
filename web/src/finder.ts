// The finder (S-09): a dialog listing recent activity, searching active
// files, and older ones on request.
import { fileLabel, relativeTime } from './format'
import { rank } from './match'
import { el } from './shell'
import type { Entry, Lists } from './types'

export const PER_SECTION = 10

export interface FinderRefs {
  dialog: HTMLDialogElement
  input: HTMLInputElement
  list: HTMLUListElement
}

export interface FinderState {
  query: string
  older: boolean
  selected: number
}

export interface FinderRow {
  entry: Entry
  older: boolean
}

export interface FinderView {
  recent: FinderRow[]
  recentTotal: number
  olderRows: FinderRow[]
  olderTotal: number
  /** Rows in display order, for keyboard selection. */
  rows: FinderRow[]
}

/** Computes what the finder shows for a query (S-09). */
export function finderView(lists: Lists, state: FinderState): FinderView {
  const query = state.query.trim()
  const olderEntries = lists.older.flatMap((g) => g.files)
  let recent: Entry[]
  let olderMatches: Entry[]
  if (query === '') {
    recent = lists.recent
    olderMatches = olderEntries
  } else {
    recent = rank(query, lists.recent).map((m) => m.item)
    olderMatches = rank(query, olderEntries).map((m) => m.item)
  }
  const recentRows = recent.slice(0, PER_SECTION).map((entry) => ({ entry, older: false }))
  const olderRows = state.older ? olderMatches.slice(0, PER_SECTION).map((entry) => ({ entry, older: true })) : []
  return { recent: recentRows, recentTotal: recent.length, olderRows, olderTotal: olderMatches.length, rows: [...recentRows, ...olderRows] }
}

export function buildFinder(root: HTMLElement = document.body): FinderRefs {
  const input = el('input', { type: 'text', placeholder: 'Open file…', 'aria-label': 'Find a file', autocomplete: 'off', spellcheck: 'false' })
  const list = el('ul', { role: 'listbox' })
  const dialog = el('dialog', { id: 'finder', 'aria-label': 'Find a file' }, input, list)
  root.append(dialog)
  return { dialog, input, list }
}

function title(text: string, shown: number, total: number, older: boolean): HTMLLIElement {
  const li = el('li', { class: 'tier' + (older ? ' older' : '') })
  li.textContent = shown < total ? `${text} · ${shown} of ${total}` : text
  return li
}

/** Renders the rows; `now` is for the times. */
export function renderFinder(refs: FinderRefs, view: FinderView, state: FinderState, now: number = Date.now() / 1000): void {
  const { list } = refs
  list.replaceChildren()
  let index = 0
  const row = (r: FinderRow): HTMLLIElement => {
    const a = el('a', { href: r.entry.path }, fileLabel(r.entry.name, r.entry.dir, { type: r.entry.type, path: r.entry.path }))
    if (r.entry.copies && r.entry.copies > 1) a.append(el('span', { class: 'copies', text: `×${r.entry.copies}` }))
    if (r.entry.time && !r.older) a.append(el('time', { text: relativeTime(r.entry.time, now) }))
    const li = el('li', { class: 'row' + (r.older ? ' older' : ''), role: 'option' }, a)
    li.dataset.index = String(index)
    if (index === state.selected) {
      li.classList.add('selected')
      li.setAttribute('aria-selected', 'true')
    }
    index++
    return li
  }
  list.append(title('Recent', view.recent.length, view.recentTotal, false))
  if (view.recent.length === 0) list.append(el('li', { class: 'none', text: state.query.trim() ? 'No recent file matches' : 'Nothing recent' }))
  for (const r of view.recent) list.append(row(r))
  if (state.older) {
    list.append(title('Older', view.olderRows.length, view.olderTotal, true))
    if (view.olderRows.length === 0) list.append(el('li', { class: 'none older', text: 'No older file matches' }))
    for (const r of view.olderRows) list.append(row(r))
    list.append(el('li', { class: 'toggle', text: 'Tab · hide older files' }))
  } else {
    const n = view.olderTotal
    list.append(el('li', { class: 'toggle', text: n === 1 ? 'Tab · 1 older file' : `Tab · ${n} older files` }))
  }
  const selected = list.querySelector('li.selected')
  if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest' })
}
