// Drawing the changes in the editor (CH-05 to CH-10): bars, lit words,
// removed units, lines and rows, the two view buttons and stepping.
import { DOMSerializer, type Node as PMNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { diffUnits, diffWords, listChanges, nextChange, onScreen, prevChange, type Change, type Diff, type Placed, type Unit, type UnitKind } from './changes'

export type ChangeView = 'now' | 'was'

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

export function kindOf(node: PMNode): UnitKind {
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return 'heading'
    case 'code_block':
      return 'code_block'
    case 'table':
      return 'table'
    case 'hr':
      return 'hr'
    case 'html':
      return 'html'
    default:
      return 'other'
  }
}

/** A unit of the document: a node, where it is, and where what comes before it goes. */
export interface DocUnit extends Unit {
  node: PMNode
  /** The position before the node. */
  from: number
  to: number
  /** Before its list item when it opens one, else before the node: where a removed unit sits. */
  slot: number
}

const containers = new Set(['bullet_list', 'ordered_list', 'blockquote'])

/** A version's units in document order: lists and quotes are walked into, their items are units (CH-05). */
export function toUnits(doc: PMNode, serialize: (n: PMNode) => string): DocUnit[] {
  const out: DocUnit[] = []
  const walk = (parent: PMNode, start: number, item: PMNode | null, itemPos: number) => {
    parent.forEach((node, offset, index) => {
      const from = start + offset
      const name = node.type.name
      if (containers.has(name)) walk(node, from + 1, null, 0)
      else if (name === 'list_item') walk(node, from + 1, node, from)
      else {
        let norm = serialize(node)
        if (item && item.attrs.checked != null) norm = (item.attrs.checked ? '[x] ' : '[ ] ') + norm
        const kind = kindOf(node)
        out.push({
          norm,
          kind,
          text: unitText(node),
          node,
          from,
          to: from + node.nodeSize,
          slot: item && index === 0 ? itemPos : from,
          lines: kind === 'code_block' ? node.textContent.split('\n') : undefined,
          rows: kind === 'table' ? tableRows(node) : undefined,
        })
      }
    })
  }
  walk(doc, 0, null, 0)
  return out
}

function unitText(node: PMNode): string {
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

function textual(kind: UnitKind): boolean {
  return kind === 'paragraph' || kind === 'heading'
}

export interface Model {
  baseline: DocUnit[]
  current: DocUnit[]
  diff: Diff
  changes: Change[]
}

/** Compares a baseline with the document. */
export function compare(baseline: DocUnit[], doc: PMNode, serialize: (n: PMNode) => string): Model {
  const current = toUnits(doc, serialize)
  const diff = diffUnits(baseline, current)
  return { baseline, current, diff, changes: listChanges(diff, baseline, current) }
}

export interface DrawOptions {
  model: Model
  views: Map<string, ChangeView>
  current: number
  pulse: number
  onView(change: Change, view: ChangeView): void
}

const VIEWS = [
  ['now', '▮', 'As it is now'],
  ['was', '▯', 'As it was'],
] as const

/** Builds every decoration for the current model (CH-05, CH-08, CH-09). */
export function draw(view: EditorView, opts: DrawOptions): DecorationSet {
  const { model, views, current, pulse } = opts
  const doc = view.state.doc
  const serializer = DOMSerializer.fromSchema(view.state.schema)
  const decorations: Decoration[] = []
  const rootRect = view.dom.getBoundingClientRect()
  const rootPad = parseFloat(getComputedStyle(view.dom).paddingLeft) || 0

  /** How far a node's box starts right of the text column, so bars stay in the gutter (CH-05). */
  const indentOf = (from: number): number => {
    const el = view.nodeDOM(from)
    if (!(el instanceof Element)) return 0
    return Math.max(0, Math.round(el.getBoundingClientRect().left - rootRect.left - rootPad))
  }
  const indentStyle = (from: number) => `--indent: ${indentOf(from)}px`
  const beforePos = (unit: number) => (unit < model.current.length ? model.current[unit].slot : doc.content.size)
  const beforeIndent = (unit: number) => (unit < model.current.length ? indentOf(model.current[unit].from) : 0)
  const tagAt = (pos: number) => {
    const parent = doc.resolve(pos).parent.type.name
    return parent === 'bullet_list' || parent === 'ordered_list' ? 'li' : 'div'
  }
  const stateOf = (i: number) => (i === current ? ' change-current' : '') + (i === pulse ? ' change-pulse' : '')
  const widget = (pos: number, el: HTMLElement, side: number, key: string) => decorations.push(Decoration.widget(pos, el, { side, key, ignoreSelection: true }))

  // Two buttons before each change that has an old version: a changed or
  // removed unit, or a code block or table with changes inside, whose
  // changes share them (CH-08, CH-09).
  const groups = new Map<string, number[]>()
  model.changes.forEach((c, i) => {
    if (c.kind !== 'added') groups.set(c.viewKey, [...(groups.get(c.viewKey) ?? []), i])
  })
  for (const [key, indices] of groups) {
    const c = model.changes[indices[0]]
    const pos = c.kind === 'removed' ? beforePos(c.unit) : model.current[c.unit].from
    const indent = c.kind === 'removed' ? beforeIndent(c.unit) : indentOf(pos)
    const picked = views.get(key) ?? 'now'
    const isCurrent = indices.includes(current)
    const wrap = document.createElement(tagAt(pos))
    wrap.className = 'change-controls' + (isCurrent ? ' current' : '')
    wrap.style.setProperty('--indent', indent + 'px')
    wrap.contentEditable = 'false'
    const span = document.createElement('span')
    for (const [v, glyph, title] of VIEWS) {
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
        opts.onView(c, v)
      })
      span.append(b)
    }
    wrap.append(span)
    widget(pos, wrap, -2, `controls-${key}-${picked}-${isCurrent}`)
  }

  /** A unit's old version, drawn in place of it (CH-08). */
  const oldBlock = (old: DocUnit, unit: number, state: string): HTMLElement => {
    const el = document.createElement('div')
    el.className = 'change-old' + state
    el.dataset.unit = String(unit)
    el.contentEditable = 'false'
    el.append(serializer.serializeNode(old.node))
    const note = document.createElement('div')
    note.className = 'change-note'
    note.textContent = 'as it was'
    el.append(note)
    return el
  }

  // Code blocks and tables with changes inside: shown whole as they were when asked.
  const holders = new Map<number, string>()

  model.changes.forEach((c, i) => {
    const state = stateOf(i)
    const attrs = { 'data-change': String(i) }
    const picked = views.get(c.viewKey) ?? 'now'
    switch (c.kind) {
      case 'added': {
        const u = model.current[c.unit]
        decorations.push(Decoration.node(u.from, u.to, { class: 'change-block change-added' + state, style: indentStyle(u.from), ...attrs }))
        if (textual(u.kind) && u.node.content.size > 0) decorations.push(Decoration.inline(u.from + 1, u.to - 1, { class: 'change-inserted' }))
        break
      }
      case 'modified': {
        const u = model.current[c.unit]
        const old = model.baseline[c.baseline]
        const classes = 'change-block change-modified' + state
        if (picked === 'was') {
          decorations.push(Decoration.node(u.from, u.to, { class: classes + ' change-hidden', ...attrs }))
          const el = oldBlock(old, c.unit, state)
          el.dataset.change = String(i)
          el.style.setProperty('--indent', indentOf(u.from) + 'px')
          widget(u.from, el, -1, `old-${c.key}${state}`)
        } else {
          decorations.push(Decoration.node(u.from, u.to, { class: classes, style: indentStyle(u.from), ...attrs }))
          if (textual(u.kind)) decorations.push(...wordDecorations(u.node, u.from, old.text))
        }
        break
      }
      case 'removed': {
        const pos = beforePos(c.unit)
        const el = document.createElement(tagAt(pos))
        el.className = 'change-removed' + (picked === 'now' ? ' change-collapsed' : '') + state
        el.dataset.change = String(i)
        el.style.setProperty('--indent', beforeIndent(c.unit) + 'px')
        el.contentEditable = 'false'
        el.append(serializer.serializeNode(model.baseline[c.baseline].node))
        widget(pos, el, -1, `removed-${c.key}-${picked}${state}`)
        break
      }
      case 'lines': {
        const u = model.current[c.unit]
        holders.set(c.unit, c.viewKey)
        const lines = u.lines ?? []
        const starts = lineStarts(lines)
        const { hunk } = c
        if (hunk.to > hunk.from) {
          const kind = hunk.oldTo > hunk.oldFrom ? ' change-line-modified' : ' change-line-added'
          for (let k = hunk.from; k < hunk.to; k++) {
            const a = u.from + 1 + starts[k]
            const b = a + lines[k].length
            if (b > a) decorations.push(Decoration.inline(a, b, { class: 'change-line' + kind + state, ...attrs }))
            else {
              const el = document.createElement('span')
              el.className = 'change-line change-line-empty' + kind + state
              el.dataset.change = String(i)
              el.contentEditable = 'false'
              widget(a, el, 0, `line-${c.key}-${k}${state}`)
            }
          }
        } else {
          const a = u.from + 1 + (hunk.from < lines.length ? starts[hunk.from] : u.node.content.size)
          const el = document.createElement('span')
          el.className = 'change-gone-lines' + state
          el.dataset.change = String(i)
          el.title = 'removed:\n' + (model.baseline[c.baseline].lines ?? []).slice(hunk.oldFrom, hunk.oldTo).join('\n')
          el.contentEditable = 'false'
          widget(a, el, -1, `gone-${c.key}${state}`)
        }
        break
      }
      case 'row': {
        const u = model.current[c.unit]
        holders.set(c.unit, c.viewKey)
        const { pos, row } = rowAt(u, c.row)
        decorations.push(Decoration.node(pos, pos + row.nodeSize, { class: 'change-row' + state, ...attrs }))
        let cellPos = pos + 1
        row.forEach((cell, _offset, col) => {
          if (c.cells.includes(col)) {
            decorations.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'change-cell' + (c.baselineRow === null ? ' change-cell-added' : '') }))
          }
          cellPos += cell.nodeSize
        })
        break
      }
      case 'row-removed': {
        const u = model.current[c.unit]
        holders.set(c.unit, c.viewKey)
        const last = u.node.childCount - 1
        const after = c.before > last
        const { pos, row } = rowAt(u, after ? last : c.before)
        decorations.push(Decoration.node(pos, pos + row.nodeSize, { class: after ? 'change-row-gone-after' : 'change-row-gone', 'data-change-before': String(i) }))
        break
      }
    }
  })

  for (const [unit, key] of holders) {
    const u = model.current[unit]
    const picked = views.get(key) ?? 'now'
    const mark = model.diff.units[unit]
    if (picked === 'was' && mark.baseline !== undefined) {
      decorations.push(Decoration.node(u.from, u.to, { class: 'change-holder change-hidden' }))
      widget(u.from, oldBlock(model.baseline[mark.baseline], unit, ''), -1, `old-${key}`)
    } else {
      decorations.push(Decoration.node(u.from, u.to, { class: 'change-holder' }))
    }
  }

  return DecorationSet.create(doc, decorations)
}

function lineStarts(lines: string[]): number[] {
  const out: number[] = []
  let at = 0
  for (const line of lines) {
    out.push(at)
    at += line.length + 1
  }
  return out
}

function rowAt(table: DocUnit, index: number): { pos: number; row: PMNode } {
  let pos = table.from + 1
  for (let i = 0; i < index; i++) pos += table.node.child(i).nodeSize
  return { pos, row: table.node.child(index) }
}

/** New words lit in place; a small mark where words were removed (CH-08). */
function wordDecorations(node: PMNode, pos: number, oldText: string): Decoration[] {
  const out: Decoration[] = []
  const ops = diffWords(oldText, node.textContent)
  // Map offsets in the unit's text to document positions.
  const offsets: number[] = []
  node.descendants((child, childPos) => {
    if (child.isText) {
      for (let k = 0; k < (child.text?.length ?? 0); k++) offsets.push(pos + 1 + childPos + k)
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
      el.className = 'change-gone'
      el.title = 'removed: ' + op.text.trim()
      el.contentEditable = 'false'
      out.push(Decoration.widget(posAt(offset), el, { side: -1, key: 'gone-' + posAt(offset) + '-' + op.text, ignoreSelection: true }))
    }
  }
  return out
}

/** Applies decorations to the view without touching the document. */
export function apply(view: EditorView, set: DecorationSet): void {
  view.dispatch(view.state.tr.setMeta(changesKey, set).setMeta('addToHistory', false).setMeta('margin-external', true))
}

/** Where each change sits in the scroller, from its drawn parts. */
export function place(view: EditorView, model: Model, scroller: HTMLElement): Placed[] {
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
    for (const el of view.dom.querySelectorAll(`[data-change="${i}"], [data-change-before="${i}"]`)) consider(el)
    if (top === Infinity && change.kind !== 'removed') {
      for (const el of view.dom.querySelectorAll(`[data-unit="${change.unit}"]`)) consider(el)
    }
    if (top === Infinity && model.current.length > 0) {
      const u = model.current[Math.min(change.unit, model.current.length - 1)]
      const dom = view.nodeDOM(u.from)
      consider(dom instanceof Element ? dom : null)
    }
    if (top === Infinity) return { top: 0, bottom: 0 }
    return { top, bottom }
  })
}

export { nextChange, prevChange, onScreen }

/** The units a transaction touched, for advancing the local baseline (CH-14). */
export function touchedUnits(tr: Transaction, units: DocUnit[]): Set<number> {
  const out = new Set<number>()
  for (const step of tr.steps) {
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      for (const p of [newStart, Math.max(newStart, newEnd - 1)]) {
        const i = units.findIndex((u) => p >= u.from && p < u.to)
        if (i >= 0) out.add(i)
      }
    })
  }
  return out
}
