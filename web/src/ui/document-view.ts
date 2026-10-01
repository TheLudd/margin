import type { State } from '../document/session'
import { type LogicalFile, worktreeName } from './copies'
import { display } from './display'
import { h, timeAgo } from './dom'

const openMenus = ".milkdown-slash-menu[data-show='true'], .milkdown-link-edit[data-show='true']"

const statusText: Record<State, string> = {
  clean: 'saved',
  dirty: 'unsaved',
  saving: 'saving',
  conflict: 'conflict',
  missing: 'deleted',
  error: 'save failed, retrying',
}

export interface ConflictActions {
  keepMine(): void
  takeTheirs(): void
}

// The chrome around the editor: path, save status, conflict banner and the
// frontmatter panel.
export class DocumentView {
  private readonly pathEl = h('span', { class: 'path' })
  private readonly statusEl = h('span', { class: 'status' })
  private readonly worktreeEl = h('select', { class: 'worktree', title: 'Worktree', hidden: true })
  private readonly bannerEl = h('div', { class: 'banner', hidden: true })
  private readonly textarea = h('textarea', { spellcheck: 'false' })
  private readonly frontmatterEl = h('details', { class: 'frontmatter', hidden: true }, h('summary', {}, 'frontmatter'), this.textarea)
  readonly editorEl = h('div', { class: 'editor' })

  constructor(
    root: HTMLElement,
    onFrontmatter: (value: string) => void,
    onWorktree: (path: string) => void,
  ) {
    root.append(
      h('header', { class: 'doc-header' }, this.pathEl, this.worktreeEl, h('span', { class: 'mode' }, 'editing'), this.statusEl),
      this.bannerEl,
      h('article', {}, this.frontmatterEl, this.editorEl),
    )
    this.worktreeEl.addEventListener('change', () => onWorktree(this.worktreeEl.value))
    // Esc leaves the editor, back to reading (and to Vimium's keys), unless it
    // closes a menu first. It is caught before ProseMirror, which takes it.
    this.editorEl.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || this.editorEl.querySelector(openMenus)) return
        event.preventDefault()
        event.stopPropagation()
        ;(document.activeElement as HTMLElement | null)?.blur()
      },
      true,
    )
    this.textarea.addEventListener('input', () => {
      this.fit()
      onFrontmatter(this.textarea.value)
    })
  }

  show(path: string, frontmatter: string) {
    this.pathEl.textContent = display(path)
    document.title = `${path.slice(path.lastIndexOf('/') + 1)} · margin`
    this.state('clean')
    this.frontmatter(frontmatter)
  }

  // Lets the user switch between the copies of the open file in other
  // worktrees. Hidden when there is only one.
  copies(file: LogicalFile | undefined, current: string) {
    const copies = file?.copies ?? []
    this.worktreeEl.hidden = copies.length < 2
    this.worktreeEl.replaceChildren(
      ...copies.map((copy) => {
        const state = copy.changed ? `changed ${ago(copy.changed)}` : copy.main ? 'main' : 'unchanged'
        return h('option', { value: copy.path, selected: copy.path === current }, `${worktreeName(copy)} · ${state}`)
      }),
    )
  }

  frontmatter(value: string) {
    this.textarea.value = value
    this.frontmatterEl.hidden = value === ''
    this.fit()
  }

  state(state: State, actions?: ConflictActions) {
    this.statusEl.textContent = statusText[state]
    this.statusEl.dataset.state = state
    this.bannerEl.hidden = state !== 'conflict' && state !== 'missing'
    if (state === 'missing') {
      this.bannerEl.replaceChildren('This file was deleted or moved. Edits are not saved.')
    }
    if (state === 'conflict' && actions) {
      const keep = h('button', {}, 'Keep mine')
      const take = h('button', {}, 'Take theirs')
      keep.onclick = () => actions.keepMine()
      take.onclick = () => actions.takeTheirs()
      this.bannerEl.replaceChildren('This file changed on disk while you were editing.', keep, take)
    }
  }

  private fit() {
    this.textarea.rows = Math.max(2, this.textarea.value.split('\n').length - 1)
  }
}

function ago(iso: string) {
  const since = timeAgo(iso)
  return since === 'now' ? 'just now' : `${since} ago`
}
