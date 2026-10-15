// The sidebar (S): Recent and Older, foldable with counts, every entry a
// real link, the unread mark drawn in existing padding, and the settings
// row at the foot.
import { fileLabel, relativeTime } from './format'
import { el } from './shell'
import type { Entry, Lists } from './types'

export interface SidebarRefs {
  root: HTMLElement
  brandRow: HTMLElement
  closeButton: HTMLButtonElement
  unfoldButton: HTMLButtonElement
  findButton: HTMLButtonElement
  recent: HTMLDetailsElement
  older: HTMLDetailsElement
  recentBody: HTMLElement
  olderBody: HTMLElement
  recentCount: HTMLElement
  olderCount: HTMLElement
  settingsRow: HTMLAnchorElement
}

/** Fold state, per browser, across reloads (S-04). */
export interface FoldStore {
  get(key: string): boolean | null
  set(key: string, open: boolean): void
}

export function localFolds(storage: Storage | null = safeStorage()): FoldStore {
  return {
    get(key) {
      try {
        const v = storage?.getItem('margin.fold.' + key)
        return v === null || v === undefined ? null : v === '1'
      } catch {
        return null
      }
    },
    set(key, open) {
      try {
        storage?.setItem('margin.fold.' + key, open ? '1' : '0')
      } catch {
        // Nothing to do; the fold still applies for this page.
      }
    },
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Builds the sidebar's fixed parts once. */
export function buildSidebar(root: HTMLElement, folds: FoldStore): SidebarRefs {
  const closeButton = el('button', { class: 'close-sidebar', type: 'button', 'aria-label': 'Fold the sidebar', title: 'Fold the sidebar', text: '×' })
  const unfoldButton = el('button', { class: 'unfold-sidebar', type: 'button', 'aria-label': 'Unfold the sidebar', title: 'Unfold the sidebar', text: '»' })
  const brandRow = el('div', { class: 'brand-row' }, el('a', { class: 'brand', href: '/', text: 'margin' }), closeButton)
  const findButton = el('button', { class: 'find', type: 'button' }, el('span', { text: 'Open file…' }), el('kbd', { text: 'Ctrl K' }))
  const recentCount = el('span', { class: 'count' })
  const olderCount = el('span', { class: 'count' })
  const recentBody = el('div')
  const olderBody = el('div')
  const recent = el('details', { class: 'section', 'data-section': 'recent' }, el('summary', {}, el('h2', { text: 'Recent' }), recentCount), recentBody)
  const older = el('details', { class: 'section', 'data-section': 'older' }, el('summary', {}, el('h2', { text: 'Older' }), olderCount), olderBody)
  const settingsRow = el('a', { class: 'settings-row', href: '/settings', title: 'Settings' }, el('span', { class: 'gear', text: '⚙' }), ' settings')
  root.append(unfoldButton, brandRow, findButton, recent, older, settingsRow)
  for (const [key, details, fallback] of [
    ['recent', recent, true],
    ['older', older, true],
  ] as const) {
    details.open = folds.get(key) ?? fallback
    details.addEventListener('toggle', () => folds.set(key, details.open))
  }
  return { root, brandRow, closeButton, unfoldButton, findButton, recent, older, recentBody, olderBody, recentCount, olderCount, settingsRow }
}

export interface SidebarView {
  lists: Lists
  current: string | null
  now?: number
}

/** Fills the lists; fold state of project groups is kept (S-04). */
export function renderSidebar(refs: SidebarRefs, view: SidebarView, folds: FoldStore): void {
  const { lists, current } = view
  const now = view.now ?? Date.now() / 1000
  refs.recentCount.textContent = String(lists.recent.length)
  refs.recentBody.replaceChildren()
  if (lists.recent.length === 0) {
    refs.recentBody.append(el('p', { class: 'empty', text: `Nothing in the last ${lists.activeDays} days` }))
  } else {
    const ul = el('ul')
    for (const e of lists.recent) ul.append(recentItem(e, current, now))
    refs.recentBody.append(ul)
  }
  const total = lists.older.reduce((n, g) => n + g.files.length, 0)
  refs.olderCount.textContent = String(total)
  refs.olderBody.replaceChildren()
  if (total === 0) {
    refs.olderBody.append(el('p', { class: 'empty', text: 'Nothing yet' }))
    return
  }
  for (const g of lists.older) {
    const key = 'project:' + g.project
    const group = el('details', { class: 'project', 'data-project': g.project }, el('summary', {}, el('span', { text: g.project }), el('span', { class: 'count', text: String(g.files.length) })))
    group.open = folds.get(key) ?? false
    group.addEventListener('toggle', () => folds.set(key, group.open))
    const ul = el('ul')
    for (const e of g.files) ul.append(olderItem(e, current))
    group.append(ul)
    refs.olderBody.append(group)
  }
}

function link(e: Entry, current: string | null): HTMLAnchorElement {
  const a = el('a', { href: e.path }, fileLabel(e.name, e.dir))
  if (e.unread) a.classList.add('unread')
  if (e.path === current) a.classList.add('current')
  return a
}

function copies(e: Entry): HTMLElement | null {
  if (!e.copies || e.copies < 2) return null
  const span = el('span', { class: 'copies', text: `×${e.copies}` })
  if (e.copiesChanged) span.classList.add('changed')
  return span
}

function recentItem(e: Entry, current: string | null, now: number): HTMLLIElement {
  const a = link(e, current)
  const c = copies(e)
  if (c) a.append(c)
  if (e.time) {
    const time = el('time', { datetime: new Date(e.time * 1000).toISOString(), text: relativeTime(e.time, now) })
    if (e.kind === 'modified') time.classList.add('modified')
    a.append(time)
  }
  const forget = el('button', { class: 'forget', type: 'button', 'aria-label': `Forget ${e.name}`, title: 'Forget', text: '×' })
  forget.dataset.path = e.path
  return el('li', { class: 'recent-entry' }, a, forget)
}

function olderItem(e: Entry, current: string | null): HTMLLIElement {
  const a = link(e, current)
  const c = copies(e)
  if (c) a.append(c)
  return el('li', {}, a)
}
