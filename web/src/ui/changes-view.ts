import type { Baseline } from '../document/comparison'
import { h } from './dom'

const labels: Record<Baseline, string> = { seen: 'unread', committed: 'uncommitted' }

// The changes found by the editor's changes plugin.
const changeSelector = '.change-block, .change-removed'

export interface ChangesActions {
  use(baseline: Baseline): void
  markRead(): void
}

// Header controls for the changes shown in the document: which baseline
// they are against, how many there are, stepping through them, and marking
// them read.
export class ChangesView {
  private readonly picker = h('span', { class: 'baselines' })
  private readonly countEl = h('span', { class: 'count' })
  private readonly previousEl = h('button', { type: 'button', title: 'Previous change (Alt ↑)' }, '↑')
  private readonly nextEl = h('button', { type: 'button', title: 'Next change (Alt ↓)' }, '↓')
  private readonly markEl = h('button', { type: 'button', class: 'mark-read' }, 'mark read')
  private current: Baseline = 'seen'
  readonly el = h('span', { class: 'changes', hidden: true }, this.picker, this.countEl, this.previousEl, this.nextEl, this.markEl)

  constructor(
    private readonly scroller: HTMLElement,
    private readonly actions: ChangesActions,
  ) {
    this.previousEl.onclick = () => this.step(-1)
    this.nextEl.onclick = () => this.step(1)
    this.markEl.onclick = () => actions.markRead()
    document.addEventListener('keydown', (event) => {
      if (!event.altKey || this.el.hidden || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      this.step(event.key === 'ArrowUp' ? -1 : 1)
    })
  }

  baselines(available: Baseline[], current: Baseline) {
    this.current = current
    this.el.hidden = available.length === 0
    this.picker.replaceChildren(
      ...available.map((baseline) => {
        const button = h('button', { type: 'button', class: baseline === current ? 'active' : undefined }, labels[baseline])
        button.onclick = () => this.actions.use(baseline)
        return button
      }),
    )
    this.update()
  }

  // Recounts the changes shown; called whenever the editor recomputes them.
  update() {
    const count = this.changes().length
    this.countEl.textContent = count === 0 ? 'no changes' : count === 1 ? '1 change' : `${count} changes`
    this.previousEl.disabled = this.nextEl.disabled = count === 0
    this.markEl.hidden = this.current !== 'seen' || count === 0
  }

  // Scrolls to the next change below the middle of the view, or the
  // previous one above it.
  private step(direction: 1 | -1) {
    const view = this.scroller.getBoundingClientRect()
    const middle = view.top + view.height / 2
    const centers = this.changes().map((el) => {
      const box = el.getBoundingClientRect()
      return { el, center: box.top + box.height / 2 }
    })
    const target =
      direction === 1 ? centers.find((c) => c.center > middle + 1) : centers.findLast((c) => c.center < middle - 1)
    target?.el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  private changes(): HTMLElement[] {
    return [...this.scroller.querySelectorAll<HTMLElement>(changeSelector)]
  }
}
