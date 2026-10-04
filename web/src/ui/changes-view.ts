import type { Baseline } from '../document/comparison'
import type { Focus } from '../editor/changes'
import { debounce } from '../sync'
import { h } from './dom'

// What the changes against each baseline are called.
const kinds: Record<Baseline, string> = { seen: 'unread', committed: 'uncommitted' }

// The changes found by the editor's changes plugin.
const changeSelector = '.change-block, .change-removed'

// Header controls for the changes shown in the document: how many there
// are, stepping through them and marking them read, hidden when there are
// none; and, next to the save status, whether the file is committed, which
// shows the uncommitted changes when clicked. A change jumped to becomes
// current: it is highlighted and counted in the header until it leaves the
// screen.

// Leaves room for the sticky header.
const headerHeight = 40
// How long a change pulses once a jump reaches it.
const pulseTime = 1200
// When a jump turns out to need no scrolling, so no scrollend comes.
const stillTime = 100

export interface ChangesActions {
  use(baseline: Baseline): void
  markRead(): void
  focus(focus: Focus | undefined): void
}

export class ChangesView {
  private readonly countEl = h('button', { type: 'button', class: 'count', title: 'First change' })
  private readonly previousEl = h('button', { type: 'button', title: 'Previous change (Alt ↑)' }, '↑')
  private readonly nextEl = h('button', { type: 'button', title: 'Next change (Alt ↓)' }, '↓')
  private readonly markEl = h('button', { type: 'button', class: 'mark-read' }, 'mark read')
  private current: Baseline = 'seen'
  private focused?: Focus // as last sent to the editor
  private jumping?: number // the change being scrolled to
  private pulsing?: number
  private timer?: ReturnType<typeof setTimeout>
  readonly el = h('span', { class: 'changes', hidden: true }, this.countEl, this.previousEl, this.nextEl, this.markEl)
  readonly commitEl = h('button', { type: 'button', class: 'badge commit', hidden: true })

  constructor(
    private readonly scroller: HTMLElement,
    private readonly actions: ChangesActions,
  ) {
    this.countEl.onclick = () => this.jump(0)
    this.previousEl.onclick = () => this.step(-1)
    this.nextEl.onclick = () => this.step(1)
    this.markEl.onclick = () => actions.markRead()
    this.commitEl.onclick = () => actions.use(this.current === 'committed' ? 'seen' : 'committed')
    scroller.addEventListener('scroll', debounce(() => this.update(), 50), { passive: true })
    scroller.addEventListener('scrollend', () => this.arrive())
    document.addEventListener('keydown', (event) => {
      if (!event.altKey || this.el.hidden || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      this.step(event.key === 'ArrowUp' ? -1 : 1)
    })
  }

  // The baseline in use, and whether the file is as committed (undefined
  // when it has no committed version).
  state(current: Baseline, committed: boolean | undefined) {
    this.current = current
    this.commitEl.hidden = committed === undefined
    this.commitEl.textContent = committed ? 'committed' : 'uncommitted'
    this.commitEl.disabled = committed !== false
    this.commitEl.classList.toggle('unstable', committed === false)
    this.commitEl.title = current === 'committed' ? 'Show unread changes' : 'Show the changes since the last commit'
    this.commitEl.classList.toggle('active', current === 'committed')
    this.update()
  }

  // Shows the count and the current change; called whenever the editor
  // redraws the changes and on scrolling.
  update() {
    const changes = this.changes()
    const kept = this.focused && this.onScreen(changes[this.focused.index]) ? this.focused.index : undefined
    const index = this.jumping ?? kept
    const count = changes.length
    this.focus(index === undefined || index >= count ? undefined : index)
    const kind = kinds[this.current]
    this.countEl.textContent =
      this.focused !== undefined
        ? `Change ${this.focused.index + 1} of ${count}`
        : `${count} ${kind} ${count === 1 ? 'change' : 'changes'}`
    this.el.hidden = count === 0
    this.markEl.hidden = this.current !== 'seen'
  }

  // A new document starts without a jump in progress, or a commit status
  // until its baselines load.
  reset() {
    clearTimeout(this.timer)
    this.jumping = this.pulsing = this.focused = undefined
    this.commitEl.hidden = true
  }

  private onScreen(change: HTMLElement | undefined): boolean {
    if (!change) return false
    const view = this.scroller.getBoundingClientRect()
    const box = change.getBoundingClientRect()
    return box.bottom > view.top + headerHeight && box.top < view.bottom
  }

  private focus(index: number | undefined) {
    const next = index === undefined ? undefined : { index, pulse: index === this.pulsing }
    if (next?.index === this.focused?.index && next?.pulse === this.focused?.pulse) return
    this.focused = next
    this.actions.focus(next)
  }

  // Steps from the current change, or from the middle of the view when no
  // change is on screen.
  private step(direction: 1 | -1) {
    const changes = this.changes()
    let target: number | undefined
    if (this.focused) {
      target = this.focused.index + direction
    } else {
      const view = this.scroller.getBoundingClientRect()
      const middle = view.top + view.height / 2
      const above = (el: HTMLElement) => el.getBoundingClientRect().top < middle
      target = direction === 1 ? changes.findIndex((el) => !above(el)) : changes.findLastIndex(above)
    }
    if (target >= 0 && target < changes.length) this.jump(target)
  }

  // Scrolls to a change, which is current from then on. It pulses once it
  // is reached, so the eye finds where it went.
  private jump(index: number) {
    const change = this.changes()[index]
    if (!change) return
    clearTimeout(this.timer)
    this.jumping = index
    this.pulsing = undefined
    const before = this.scroller.scrollTop
    change.scrollIntoView({ behavior: 'smooth', block: 'center' })
    this.update()
    this.timer = setTimeout(() => {
      if (this.scroller.scrollTop === before) this.arrive()
    }, stillTime)
  }

  // A jump reached its change, or the reader scrolled.
  private arrive() {
    if (this.jumping === undefined) return
    clearTimeout(this.timer)
    this.pulsing = this.jumping
    this.jumping = undefined
    this.update()
    this.timer = setTimeout(() => {
      this.pulsing = undefined
      this.update()
    }, pulseTime)
  }

  // In document order, which is the order of their data-change indexes.
  private changes(): HTMLElement[] {
    return [...this.scroller.querySelectorAll<HTMLElement>(changeSelector)]
  }
}
