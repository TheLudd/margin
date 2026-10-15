// Drawing the changes in the editor (CH-05 to CH-10): bars, removed
// blocks, word diffs, table cells, the three view buttons and stepping.
import { DOMSerializer, type Node as PMNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { diffBlocks, diffTable, diffWords, groupChanges, nextChange, onScreen, prevChange, type Block, type BlockKind, type Change, type Diff, type Placed } from './changes'

export type ChangeView = 'now' | 'diff' | 'was'

export const changesKey = new PluginKey<DecorationSet>('margin-changes')

/** The editor-side plugin: holds the decorations, mapped through edits. */
export function changesPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: changesKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(changesKey) as DecorationSet | undefined
        if (next) return next
        return set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state: EditorState) {
        return changesKey.getState(state) ?? null
      },
    },
  })
}

export function kindOf(node: PMNode): BlockKind {
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return 'heading'
    case 'code_block':
      return 'code_block'
    case 'table':
      return 'table'
    case 'bullet_list':
    case 'ordered_list':
      return 'list'
    case 'blockquote':
      return 'blockquote'
    case 'hr':
      return 'hr'
    case 'html':
      return 'html'
    default:
      return 'other'
  }
}

/** A version's top-level blocks, by normal form. */
export function toBlocks(doc: PMNode, serialize: (n: PMNode) => string): (Block & { node: PMNode })[] {
  const out: (Block & { node: PMNode })[] = []
  doc.forEach((node) => out.push({ norm: serialize(node), kind: kindOf(node), text: blockText(node), node }))
  return out
}

function blockText(node: PMNode): string {
  if (node.type.name === 'table') return tableRows(node).map((r) => r.join(' | ')).join('\n')
  return node.textContent
}

export function tableRows(table: PMNode): string[][] {
  const rows: string[][] = []
  table.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(cell.textContent))
    rows.push(cells)
  })
  return rows
}

export interface Model {
  baseline: (Block & { node: PMNode })[]
  diff: Diff
  changes: Change[]
}

/** Compares a baseline with the document. */
export function compare(baseline: (Block & { node: PMNode })[], doc: PMNode, serialize: (n: PMNode) => string): Model {
  const current = toBlocks(doc, serialize)
  const diff = diffBlocks(baseline, current)
  return { baseline, diff, changes: groupChanges(diff) }
}

export interface DrawOptions {
  model: Model
  views: Map<string, ChangeView>
  current: number
  pulse: number
  onView(change: Change, view: ChangeView): void
}

/** Where each change's drawn parts are, to place and scroll to them. */
export interface Drawn {
  decorations: DecorationSet
  /** DOM elements per change: removed widgets and controls. */
  widgets: Map<number, HTMLElement[]>
}

function blockPos(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return pos
}

/** Builds every decoration for the current model (CH-05, CH-08, CH-09). */
export function draw(view: EditorView, opts: DrawOptions): Drawn {
  const { model, views, current, pulse } = opts
  const doc = view.state.doc
  const serializer = DOMSerializer.fromSchema(view.state.schema)
  const decorations: Decoration[] = []
  const widgets = new Map<number, HTMLElement[]>()
  const changeOf = new Map<string, number>()
  model.changes.forEach((c, i) => {
    for (const b of c.blocks) changeOf.set('b' + b, i)
    for (const r of c.removed) changeOf.set('r' + r, i)
  })
  const viewOf = (i: number): ChangeView => views.get(model.changes[i].key) ?? 'now'
  const remember = (i: number, el: HTMLElement) => widgets.set(i, [...(widgets.get(i) ?? []), el])

  // Controls before each change.
  model.changes.forEach((change, i) => {
    const pos = blockPos(doc, Math.min(change.start, doc.childCount))
    const picked = viewOf(i)
    const wrap = document.createElement('div')
    wrap.className = 'change-controls' + (i === current ? ' current' : '')
    const span = document.createElement('span')
    for (const [v, glyph, title] of [
      ['now', '▮', 'As it is now'],
      ['diff', '±', 'As a diff'],
      ['was', '▯', 'As it was'],
    ] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.view = v
      b.textContent = glyph
      b.title = title
      b.setAttribute('aria-label', title)
      if (v === picked) b.classList.add('active')
      b.addEventListener('mousedown', (ev) => ev.preventDefault())
      b.addEventListener('click', (ev) => {
        ev.preventDefault()
        opts.onView(change, v)
      })
      span.append(b)
    }
    wrap.append(span)
    remember(i, wrap)
    decorations.push(Decoration.widget(pos, wrap, { side: -2, key: 'controls-' + change.key, ignoreSelection: true }))
  })

  // Removed blocks, drawn in place.
  for (const r of model.diff.removed) {
    const i = changeOf.get('r' + r.baseline) ?? -1
    const picked = i >= 0 ? viewOf(i) : 'now'
    const pos = blockPos(doc, Math.min(r.before, doc.childCount))
    const el = document.createElement('div')
    el.className = 'change-removed'
    if (picked === 'now') el.classList.add('change-collapsed')
    if (picked === 'was') el.classList.add('change-plain')
    if (i === current) el.classList.add('change-current')
    if (i === pulse) el.classList.add('change-pulse')
    el.contentEditable = 'false'
    el.append(serializer.serializeNode(model.baseline[r.baseline].node))
    if (i >= 0) remember(i, el)
    decorations.push(Decoration.widget(pos, el, { side: -1, key: 'removed-' + r.baseline + '-' + picked + (i === current ? '-c' : ''), ignoreSelection: true }))
  }

  // Changed blocks.
  model.diff.blocks.forEach((mark, index) => {
    if (mark.mark === 'same') return
    const i = changeOf.get('b' + index) ?? -1
    const picked = i >= 0 ? viewOf(i) : 'now'
    const node = doc.child(index)
    const pos = blockPos(doc, index)
    const classes = ['change-block', mark.mark === 'added' ? 'change-added' : 'change-modified']
    if (i === current) classes.push('change-current')
    if (i === pulse) classes.push('change-pulse')
    const old = mark.baseline !== undefined ? model.baseline[mark.baseline] : null
    if (picked === 'was' && old) {
      classes.push('change-hidden')
      const el = document.createElement('div')
      el.className = 'change-old' + (i === current ? ' change-current' : '')
      el.contentEditable = 'false'
      el.append(serializer.serializeNode(old.node))
      const note = document.createElement('div')
      note.className = 'change-note'
      note.textContent = 'as it was'
      el.append(note)
      if (i >= 0) remember(i, el)
      decorations.push(Decoration.widget(pos, el, { side: -1, key: 'old-' + index, ignoreSelection: true }))
    }
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: classes.join(' ') }))
    if (picked === 'diff' && old && mark.mark === 'modified') {
      const textual = old.kind === 'paragraph' || old.kind === 'heading'
      if (textual) {
        decorations.push(...wordDecorations(node, pos, old.text))
      } else {
        const el = document.createElement('div')
        el.className = 'change-old' + (i === current ? ' change-current' : '')
        el.contentEditable = 'false'
        el.append(serializer.serializeNode(old.node))
        if (i >= 0) remember(i, el)
        decorations.push(Decoration.widget(pos, el, { side: -1, key: 'diffold-' + index, ignoreSelection: true }))
      }
    }
    if (node.type.name === 'table' && old && old.node.type.name === 'table' && picked !== 'was') {
      decorations.push(...cellDecorations(node, pos, old.node))
    }
  })

  return { decorations: DecorationSet.create(doc, decorations), widgets }
}

/** Inserted words highlighted in place; deleted words struck through where they stood (CH-08). */
function wordDecorations(node: PMNode, pos: number, oldText: string): Decoration[] {
  const out: Decoration[] = []
  const ops = diffWords(oldText, node.textContent)
  // Map offsets in the block's text to document positions.
  const offsets: number[] = []
  node.descendants((child, childPos) => {
    if (child.isText) {
      for (let k = 0; k < (child.text?.length ?? 0); k++) offsets.push(pos + 1 + childPos + k)
    } else if (child.isLeaf) {
      // An inline atom (image, hard break) counts as nothing in the text.
    }
    return true
  })
  const posAt = (offset: number) => (offset < offsets.length ? offsets[offset] : pos + node.nodeSize - 1)
  let offset = 0
  for (const op of ops) {
    if (op.kind === 'same') offset += op.text.length
    else if (op.kind === 'insert') {
      out.push(Decoration.inline(posAt(offset), posAt(offset + op.text.length - 1) + 1, { class: 'change-inserted' }))
      offset += op.text.length
    } else {
      const el = document.createElement('span')
      el.className = 'change-deleted'
      el.textContent = op.text
      el.contentEditable = 'false'
      out.push(Decoration.widget(posAt(offset), el, { side: -1, key: 'del-' + posAt(offset) + '-' + op.text, ignoreSelection: true }))
    }
  }
  return out
}

/** Tinted cells for a modified table (CH-05, L-30). */
function cellDecorations(table: PMNode, tablePos: number, oldTable: PMNode): Decoration[] {
  const marks = diffTable(tableRows(oldTable), tableRows(table))
  const out: Decoration[] = []
  let rowPos = tablePos + 1
  let r = 0
  table.forEach((row) => {
    let cellPos = rowPos + 1
    let c = 0
    row.forEach((cell) => {
      const added = marks.addedRows.has(r)
      if (added || marks.changed.has(`${r},${c}`)) {
        out.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'change-cell' + (added ? ' change-cell-added' : '') }))
      }
      cellPos += cell.nodeSize
      c++
    })
    rowPos += row.nodeSize
    r++
  })
  return out
}

/** Applies decorations to the view without touching the document. */
export function apply(view: EditorView, set: DecorationSet): void {
  view.dispatch(view.state.tr.setMeta(changesKey, set).setMeta('addToHistory', false).setMeta('margin-external', true))
}

/** Where each change sits in the scroller, from its drawn parts. */
export function place(view: EditorView, model: Model, widgets: Map<number, HTMLElement[]>, scroller: HTMLElement): Placed[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  return model.changes.map((change, i) => {
    let top = Infinity
    let bottom = -Infinity
    const consider = (el: Element | null) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.height === 0 && r.width === 0) return
      top = Math.min(top, r.top - base)
      bottom = Math.max(bottom, r.bottom - base)
    }
    for (const b of change.blocks) {
      const dom = view.nodeDOM(blockPos(view.state.doc, b))
      consider(dom instanceof Element ? dom : null)
    }
    for (const el of widgets.get(i) ?? []) if (!el.classList.contains('change-controls')) consider(el)
    if (top === Infinity) {
      const dom = view.nodeDOM(blockPos(view.state.doc, Math.min(change.start, view.state.doc.childCount - 1)))
      consider(dom instanceof Element ? dom : null)
    }
    if (top === Infinity) return { top: 0, bottom: 0 }
    return { top, bottom }
  })
}

export { nextChange, prevChange, onScreen }

/** The transaction's touched top-level blocks, for advancing the local baseline (CH-14). */
export function touchedBlocks(tr: Transaction): Set<number> {
  const out = new Set<number>()
  const doc = tr.doc
  for (const step of tr.steps) {
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      for (const p of [newStart, Math.max(newStart, newEnd - 1)]) {
        const pos = Math.max(0, Math.min(p, doc.content.size))
        const $pos = doc.resolve(pos)
        if ($pos.depth >= 1) out.add($pos.index(0))
        else if (pos < doc.content.size) out.add($pos.index(0))
      }
    })
  }
  return out
}
