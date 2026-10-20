// Reviewing changes (CH-01 to CH-14): which baseline, when to recompute,
// the header controls, stepping and mark read. The editor draws them.
import type { Transaction } from '@milkdown/kit/prose/state'
import { DecorationSet } from '@milkdown/kit/prose/view'
import { countLabel, type Placed } from './changes'
import type { EditorHandle } from './editor'
import { setCommit, type HeaderRefs } from './header'
import { apply, compare, draw, nextChange, onScreen, place, prevChange, toUnits, touchedUnits, type ChangeView, type Model } from './marks'
import type { Doc, Meta } from './types'

export type BaselineKind = 'read' | 'head'

export interface ReviewHost {
  editor: EditorHandle
  header: HeaderRefs
  scroller: HTMLElement
  doc(): Doc
  /** The baseline's markdown body (frontmatter removed), or null when there is none. */
  fetchBaseline(kind: BaselineKind): Promise<string | null>
  markRead(): Promise<void>
}

export const PULSE_MS = 1200

export class Review {
  kind: BaselineKind = 'read'
  picked = false
  model: Model | null = null
  views = new Map<string, ChangeView>()
  current = -1
  pulse = -1
  placed: Placed[] = []
  private timer: number | null = null
  private pulseTimer: number | null = null
  private loading = 0
  private destroyed = false
  private onScroll = () => this.scrolled()

  constructor(private host: ReviewHost) {
    host.scroller.addEventListener('scroll', this.onScroll, { passive: true })
  }

  /** Decides the baseline when the file opens (CH-01). */
  async start(): Promise<void> {
    this.kind = 'read'
    this.picked = false
    this.views.clear()
    this.current = -1
    await this.reload()
  }

  /** Fetches the baseline of the current kind and recomputes. */
  async reload(): Promise<void> {
    const token = ++this.loading
    const doc = this.host.doc()
    const wanted = this.kind === 'read' ? doc.unread && doc.hasCopy : doc.git === 'uncommitted'
    let model: Model | null = null
    if (wanted) {
      const text = await this.host.fetchBaseline(this.kind)
      if (token !== this.loading || this.destroyed) return
      if (text !== null) {
        const baselineDoc = this.host.editor.parse(text)
        model = compare(toUnits(baselineDoc, this.host.editor.serialize), this.host.editor.view.state.doc, this.host.editor.serialize)
      }
    }
    this.model = model
    this.current = -1
    this.redraw()
  }

  /** The uncommitted badge: the last commit as baseline, and back (CH-11). */
  async toggleHead(): Promise<void> {
    if (this.host.doc().git !== 'uncommitted') return
    this.kind = this.kind === 'head' ? 'read' : 'head'
    this.picked = true
    await this.reload()
  }

  /** Something about the file changed: unread may have come or gone. */
  async onMeta(meta: Meta): Promise<void> {
    void meta
    await this.sync()
  }

  /** After a save the server may have advanced the copy (CH-03, CH-14). */
  async onSaved(): Promise<void> {
    if (this.kind === 'read') await this.reload()
  }

  /** HEAD moved: the committed baseline may have changed (N-05). */
  async onHead(): Promise<void> {
    if (this.kind === 'head') await this.reload()
  }

  /** The document was replaced from disk: the baseline may be needed now,
      or no longer, and a new unread change switches to it (CH-01). */
  onReload(): void {
    void this.sync(true)
  }

  private async sync(newChange = false): Promise<void> {
    const doc = this.host.doc()
    if (this.kind === 'head') {
      if (doc.unread && (newChange || !this.picked)) {
        this.kind = 'read'
        this.picked = false
        await this.reload()
      } else if (doc.git !== 'uncommitted') {
        this.kind = 'read'
        await this.reload()
      } else {
        this.recompute()
      }
      return
    }
    const wanted = doc.unread && doc.hasCopy
    if (wanted !== (this.model !== null)) await this.reload()
    else this.recompute()
  }

  /** The reader edited: units that were unchanged follow the edit, so the
      reader's own edits never show (CH-14); then the marks follow (CH-10). */
  onEdit(tr: Transaction): void {
    if (!this.model) return
    const units = toUnits(this.host.editor.view.state.doc, this.host.editor.serialize)
    for (const index of touchedUnits(tr, units)) {
      const mark = this.model.diff.units[index]
      if (mark && mark.mark === 'same' && mark.baseline !== undefined) this.model.baseline[mark.baseline] = units[index]
    }
    this.scheduleRecompute()
  }

  private scheduleRecompute(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.recompute()
    }, 150)
  }

  private recompute(): void {
    if (!this.model || this.destroyed) return
    const key = this.current >= 0 ? this.model.changes[this.current]?.key : undefined
    this.model = compare(this.model.baseline, this.host.editor.view.state.doc, this.host.editor.serialize)
    this.current = key ? this.model.changes.findIndex((c) => c.key === key) : -1
    this.redraw()
  }

  private redraw(): void {
    if (this.destroyed) return
    const view = this.host.editor.view
    if (!this.model || this.model.changes.length === 0) {
      apply(view, DecorationSet.empty)
      this.placed = []
      this.updateHeader()
      return
    }
    const drawn = draw(view, {
      model: this.model,
      views: this.views,
      current: this.current,
      pulse: this.pulse,
      onView: (change, v) => {
        this.views.set(change.viewKey, v)
        this.redraw()
      },
    })
    apply(view, drawn)
    this.placed = place(view, this.model, this.host.scroller)
    this.updateHeader()
  }

  private updateHeader(): void {
    const h = this.host.header
    const n = this.model?.changes.length ?? 0
    h.changes.hidden = n === 0
    h.count.textContent = countLabel(n, this.kind, this.current)
    h.prev.disabled = n === 0 || this.current === 0
    h.next.disabled = n === 0 || this.current === n - 1
    h.markRead.hidden = this.kind !== 'read'
    setCommit(h, this.host.doc().git, this.kind === 'head')
    document.dispatchEvent(new CustomEvent('margin:changes', { detail: { count: n, current: this.current, kind: this.kind } }))
  }

  private viewport(): [number, number] {
    const s = this.host.scroller
    return [s.scrollTop, s.scrollTop + s.clientHeight]
  }

  next(): void {
    if (!this.model) return
    this.placed = place(this.host.editor.view, this.model, this.host.scroller)
    const [top, bottom] = this.viewport()
    this.jumpTo(nextChange(this.placed, this.current, top, bottom))
  }

  prev(): void {
    if (!this.model) return
    this.placed = place(this.host.editor.view, this.model, this.host.scroller)
    const [top, bottom] = this.viewport()
    this.jumpTo(prevChange(this.placed, this.current, top, bottom))
  }

  /** Centers a change, makes it current and pulses it once (CH-07). */
  jumpTo(i: number): void {
    if (!this.model || i < 0 || i >= this.model.changes.length) return
    this.placed = place(this.host.editor.view, this.model, this.host.scroller)
    const p = this.placed[i]
    const s = this.host.scroller
    const target = p.top - (s.clientHeight - (p.bottom - p.top)) / 2
    s.scrollTo({ top: Math.max(0, target) })
    this.current = i
    this.pulse = i
    this.redraw()
    if (this.pulseTimer !== null) clearTimeout(this.pulseTimer)
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null
      this.pulse = -1
      this.redraw()
    }, PULSE_MS)
  }

  private scrolled(): void {
    if (this.current < 0 || !this.model) return
    const [top, bottom] = this.viewport()
    const p = this.placed[this.current]
    if (p && !onScreen(p, top, bottom)) {
      this.current = -1
      this.redraw()
    }
  }

  /** Mark read: the copy becomes the current version (CH-03). */
  async markRead(): Promise<void> {
    await this.host.markRead()
    this.model = null
    this.current = -1
    this.redraw()
  }

  destroy(): void {
    this.destroyed = true
    this.host.scroller.removeEventListener('scroll', this.onScroll)
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.pulseTimer !== null) clearTimeout(this.pulseTimer)
  }
}
