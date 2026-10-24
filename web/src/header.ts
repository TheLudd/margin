// The document header (L-17 to L-19, J-01, J-05, W-04): the file label, the
// copies select, the changes controls and the badges, each as wide as its
// longest value so nothing moves as values change.
import { fileLabel, relativeWords, type LabelOptions } from './format'
import { el } from './shell'
import type { CopyView, GitState } from './types'
import type { Status } from './session'

export interface Badges {
  edit: HTMLButtonElement
  manual: HTMLButtonElement
  commit: HTMLButtonElement
  status: HTMLSpanElement
}

export interface HeaderRefs {
  root: HTMLElement
  path: HTMLElement
  worktree: HTMLSelectElement
  changes: HTMLElement
  count: HTMLButtonElement
  prev: HTMLButtonElement
  next: HTMLButtonElement
  markRead: HTMLButtonElement
  badges: Badges
}

export function buildHeader(): HeaderRefs {
  const path = el('div', { class: 'path' })
  const worktree = el('select', { class: 'worktree', 'aria-label': 'Copies of this file', hidden: '' })
  const count = el('button', { class: 'count', type: 'button', title: 'Go to the first change' })
  const prev = el('button', { class: 'prev', type: 'button', title: 'Previous change (P)', 'aria-label': 'Previous change', text: '↑' })
  const next = el('button', { class: 'next', type: 'button', title: 'Next change (N)', 'aria-label': 'Next change', text: '↓' })
  const markRead = el('button', { class: 'mark-read', type: 'button', text: 'mark read' })
  const changes = el('div', { class: 'changes', hidden: '' }, count, prev, next, markRead)
  const badges: Badges = {
    edit: el('button', { class: 'badge edit', type: 'button', 'data-state': 'off', title: 'Edit (E)', text: 'edit' }),
    manual: el('button', { class: 'badge manual', type: 'button', 'data-state': 'off', title: 'Edited by hand in another editor', text: 'manual' }),
    commit: el('button', { class: 'badge commit', type: 'button', 'data-state': 'committed', text: 'committed' }),
    status: el('span', { class: 'badge status', 'data-state': 'clean', role: 'status', text: 'saved' }),
  }
  const box = el('div', { class: 'badges' }, badges.edit, badges.manual, badges.commit, badges.status)
  const root = el('header', { class: 'doc-header' }, path, worktree, changes, box)
  return { root, path, worktree, changes, count, prev, next, markRead, badges }
}

export function setHeaderLabel(refs: HeaderRefs, name: string, dir: string, opts: LabelOptions = {}): void {
  refs.path.replaceChildren(fileLabel(name, dir, opts))
}

/** Lists every copy; choosing one opens it (W-04). */
export function setCopies(refs: HeaderRefs, copies: CopyView[], current: string, now: number = Date.now() / 1000): void {
  refs.worktree.replaceChildren()
  if (copies.length < 2) {
    refs.worktree.hidden = true
    return
  }
  for (const c of copies) {
    const label = c.state === 'main' ? `${c.label} · main` : c.state === 'changed' ? `${c.label} · changed ${relativeWords(c.time ?? now, now)}` : `${c.label} · unchanged`
    const option = el('option', { value: c.path, text: label })
    if (c.path === current) option.selected = true
    refs.worktree.append(option)
  }
  refs.worktree.hidden = false
}

export function setEditing(refs: HeaderRefs, on: boolean): void {
  refs.badges.edit.dataset.state = on ? 'on' : 'off'
  refs.badges.edit.classList.toggle('active', on)
  refs.badges.edit.textContent = on ? 'editing' : 'edit'
  refs.badges.edit.setAttribute('aria-pressed', on ? 'true' : 'false')
}

export function setManual(refs: HeaderRefs, on: boolean): void {
  refs.badges.manual.dataset.state = on ? 'on' : 'off'
  refs.badges.manual.classList.toggle('active', on)
  refs.badges.manual.setAttribute('aria-pressed', on ? 'true' : 'false')
}

/** The commit badge (CH-11): hidden outside git; uncommitted is lit and clickable. */
export function setCommit(refs: HeaderRefs, state: GitState, baselineHead = false): void {
  const b = refs.badges.commit
  if (!state) {
    b.hidden = true
    return
  }
  b.hidden = false
  b.textContent = state
  b.dataset.state = state
  b.classList.toggle('unstable', state === 'uncommitted')
  b.classList.toggle('untracked', state === 'untracked')
  b.classList.toggle('active', state === 'uncommitted' && baselineHead)
  b.disabled = state !== 'uncommitted'
  b.title = state === 'uncommitted' ? 'Show changes since the last commit' : ''
}

const statusText: Record<Status, string> = {
  saved: 'saved',
  unsaved: 'unsaved',
  saving: 'saving',
  conflict: 'conflict',
  deleted: 'deleted',
  retrying: 'retrying',
}

const statusState: Record<Status, string> = {
  saved: 'clean',
  unsaved: 'dirty',
  saving: 'saving',
  conflict: 'conflict',
  deleted: 'missing',
  retrying: 'error',
}

export function setStatus(refs: HeaderRefs, status: Status): void {
  const b = refs.badges.status
  b.textContent = statusText[status]
  b.dataset.state = statusState[status]
  b.classList.toggle('unstable', status !== 'saved')
}
