// Shows how the document differs from a base version of it, as found by
// compare: every changed block gets a bar in the gutter, telling new blocks
// from changed ones, changed table cells are tinted, and removed blocks
// leave a mark where they were. Shown as a diff, inserted text is
// highlighted and deleted text struck through where it was. The document
// itself is never touched, so it stays editable and the changes follow
// edits.

import { DOMSerializer, type Fragment, type Node, type Schema } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { compare, type Diff, noDiff } from './change-diff'

// Which group of changes is current, and whether it pulses after a jump.
export interface Focus {
  index: number
  pulse: boolean
}

// How a change is shown: as it is now, as a diff, or as it was.
export type View = 'new' | 'diff' | 'old'

const views: { view: View; label: string; title: string }[] = [
  { view: 'new', label: '+', title: 'Only the new version' },
  { view: 'diff', label: '±', title: 'The changes' },
  { view: 'old', label: '−', title: 'Only the old version' },
]

interface ChangesState {
  base?: Node
  view: View // how groups are shown unless the reader picks otherwise
  diff: Diff
  focus?: Focus
  views: Map<number, View> // by group, as the reader picked
  decorations: DecorationSet
}

// The transaction meta: a new base (undefined stops comparing), a new
// current group, or how one group is shown.
export type ChangesMeta = { base?: Node } | { focus?: Focus } | { view: { index: number; view: View } }

export const changesKey = new PluginKey<ChangesState>('changes')

// view is how changes are shown until the reader picks otherwise. onUpdate
// is called whenever the changes shown are redrawn.
export function changesPlugin(view: View, onUpdate: () => void): Plugin<ChangesState> {
  return new Plugin<ChangesState>({
    key: changesKey,
    state: {
      init: () => ({ view, diff: noDiff, views: new Map(), decorations: DecorationSet.empty }),
      apply(tr, value, _, state) {
        const meta = tr.getMeta(changesKey) as ChangesMeta | undefined
        if (!meta && !tr.docChanged) return value
        let { base, diff, focus, views } = value
        if (meta && 'focus' in meta) {
          focus = meta.focus
        } else if (meta && 'view' in meta) {
          views = new Map(views).set(meta.view.index, meta.view.view)
        } else {
          // Comparing again with the same base keeps how changes are shown.
          if (meta && 'base' in meta && !sameBase(base, meta.base)) {
            base = meta.base
            views = new Map()
          }
          diff = base ? compare(base, state.doc) : noDiff
        }
        return { base, view, diff, focus, views, decorations: draw(state.doc, diff, focus, views, view) }
      },
    },
    props: {
      decorations: (state) => changesKey.getState(state)?.decorations,
    },
    view: () => ({
      update(view, previous) {
        if (changesKey.getState(view.state) !== changesKey.getState(previous)) onUpdate()
      },
    }),
  })
}

function sameBase(a: Node | undefined, b: Node | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.eq(b))
}

// Each change carries its group in data-change, for the header to refer to,
// and gets buttons in the gutter to show its group as it is, as a diff or as
// it was. Groups the reader picked no view for are shown as fallback.
function draw(doc: Node, diff: Diff, focus: Focus | undefined, shown: Map<number, View>, fallback: View): DecorationSet {
  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const decorations: Decoration[] = []
  const plain: { from: number; to: number }[] = [] // blocks not shown as a diff
  diff.changes.forEach((change, i) => {
    const index = change.group
    const view = shown.get(index) ?? fallback
    const current = focus?.index === index
    const first = diff.changes[i - 1]?.group !== index
    const classes = [`change-${change.kind}`]
    if (current) classes.push('change-current')
    if (current && focus.pulse) classes.push('change-pulse')
    const at = change.kind === 'block' ? change.from : change.at
    // Removed blocks come before a block at the same position: controls,
    // then what they control.
    const side = change.kind === 'block' ? -2 : -4
    // The buttons of the current group show by its first change only.
    decorations.push(controls(at, side, index, view, current && first, change.kind === 'block' ? change.depth : 0))

    if (change.kind === 'removed') {
      if (view === 'new') classes.push('change-collapsed')
      if (view === 'old') classes.push('change-plain')
      const content = view === 'new' ? '' : change.content
      decorations.push(block(at, side + 1, index, classes, 0, content, serializer, `removed:${change.key}`))
      return
    }
    if (view !== 'diff') plain.push(change)
    if (view === 'old') {
      decorations.push(Decoration.node(change.from, change.to, { class: 'change-hidden' }))
      classes.push('change-old')
      const content = change.added ? 'Not in the old version' : change.old
      decorations.push(block(at, side + 1, index, classes, change.depth, content, serializer, `old:${change.from}`))
      return
    }
    if (change.stacked && view === 'diff') {
      // Only text reads well struck through.
      const struck = ['paragraph', 'heading'].includes(doc.nodeAt(change.from)!.type.name)
      const old = ['change-removed', ...(struck ? [] : ['change-plain']), ...classes.slice(1)]
      decorations.push(block(at, side + 1, index, old, change.depth, change.old, serializer, `stacked:${change.from}`))
    }
    classes.push(change.added ? 'change-added' : 'change-modified')
    const attrs = { class: classes.join(' '), style: `--list-depth: ${change.depth}`, 'data-change': String(index) }
    decorations.push(Decoration.node(change.from, change.to, attrs))
    for (const cell of change.cells) {
      decorations.push(Decoration.node(cell.from, cell.to, { class: cell.added ? 'change-cell change-cell-added' : 'change-cell' }))
    }
  })
  const inPlain = (from: number, to: number) => plain.some((p) => from >= p.from && to <= p.to)
  for (const mark of diff.marks) {
    if (mark.kind === 'inserted' && !inPlain(mark.from, mark.to)) {
      decorations.push(Decoration.inline(mark.from, mark.to, { class: 'change-inserted' }))
    }
    if (mark.kind === 'deleted' && !inPlain(mark.at, mark.at)) decorations.push(deletedText(mark.content, doc.type.schema, mark.at))
  }
  return DecorationSet.create(doc, decorations)
}

// A block drawn in place of the document's: removed blocks, or a block as
// it was. content is what to draw, or a note in its place.
function block(
  at: number,
  side: number,
  index: number,
  classes: string[],
  depth: number,
  content: Fragment | string,
  serializer: DOMSerializer,
  key: string,
): Decoration {
  const className = classes.join(' ')
  const render = () => {
    const el = document.createElement('div')
    el.className = className
    el.dataset.change = String(index)
    el.style.setProperty('--list-depth', String(depth))
    el.contentEditable = 'false'
    if (typeof content !== 'string') el.append(serializer.serializeFragment(content))
    else if (content) el.append(Object.assign(document.createElement('p'), { className: 'change-note', textContent: content }))
    return el
  }
  return Decoration.widget(at, render, { side, ignoreSelection: true, key: `${key}:${className}:${typeof content === 'string' ? content : ''}` })
}

// The buttons that show a change as it is, as a diff or as it was.
function controls(at: number, side: number, index: number, view: View, current: boolean, depth: number): Decoration {
  const render = (editor: EditorView) => {
    const el = document.createElement('div')
    el.className = current ? 'change-controls current' : 'change-controls'
    el.style.setProperty('--list-depth', String(depth))
    el.contentEditable = 'false'
    const buttons = document.createElement('span')
    for (const option of views) {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: option.label, title: option.title })
      if (option.view === view) button.className = 'active'
      button.addEventListener('mousedown', (event) => event.preventDefault()) // keeps the editor's selection
      button.addEventListener('click', () => {
        const meta: ChangesMeta = { view: { index, view: option.view } }
        editor.dispatch(editor.state.tr.setMeta(changesKey, meta))
      })
      buttons.append(button)
    }
    el.append(buttons)
    return el
  }
  return Decoration.widget(at, render, {
    side,
    ignoreSelection: true,
    stopEvent: () => true,
    key: `controls:${at}:${index}:${view}:${current}:${depth}`,
  })
}

// Deleted inline content, shown struck through at `at` with its marks, so
// deleted code still reads as code.
function deletedText(content: Fragment, schema: Schema, at: number): Decoration {
  const render = () => {
    const el = Object.assign(document.createElement('del'), { className: 'change-deleted' })
    el.append(DOMSerializer.fromSchema(schema).serializeFragment(content))
    return el
  }
  return Decoration.widget(at, render, { side: -1, ignoreSelection: true, key: `del:${content.toString()}` })
}
