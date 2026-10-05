// Shows how the document differs from a base version of it: inserted text
// is highlighted, deleted text is shown struck through where it was, and
// every changed block gets a bar in the gutter. The document itself is
// never touched, so it stays editable and the changes follow edits.

import { computeDocDiff } from '@milkdown/kit/plugin/diff'
import { simplifyChanges } from '@milkdown/kit/prose/changeset'
import { DOMSerializer, type Fragment, type Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

// A change the reader steps through: a changed block, with what it was
// (empty for a new block), or the blocks removed at a position.
type Change =
  | { kind: 'block'; from: number; to: number; depth: number; old: Fragment }
  | { kind: 'removed'; at: number; content: Fragment; key: string }

interface Diff {
  marks: Decoration[] // inserted text and deleted words, within the changes
  changes: Change[] // in document order
}

// Which change is current, and whether it pulses after a jump.
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
  diff: Diff
  focus?: Focus
  views: Map<number, View> // by change index; unlisted changes show as a diff
  decorations: DecorationSet
}

// The transaction meta: a new base (undefined stops comparing), a new
// current change, or how one change is shown.
export type ChangesMeta = { base?: Node } | { focus?: Focus } | { view: { index: number; view: View } }

export const changesKey = new PluginKey<ChangesState>('changes')

const noDiff: Diff = { marks: [], changes: [] }

// onUpdate is called whenever the changes shown are redrawn.
export function changesPlugin(onUpdate: () => void): Plugin<ChangesState> {
  return new Plugin<ChangesState>({
    key: changesKey,
    state: {
      init: () => ({ diff: noDiff, views: new Map(), decorations: DecorationSet.empty }),
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
        return { base, diff, focus, views, decorations: draw(state.doc, diff, focus, views) }
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

// Heading ids are derived from their text, so they only add noise.
const ignoreAttrs = { heading: ['id'] }

export function compare(base: Node, doc: Node): Diff {
  let steps
  try {
    // Widened to whole words, which read better than single characters.
    steps = simplifyChanges(computeDocDiff(base, doc, { ignoreAttrs }), doc)
  } catch {
    return noDiff
  }
  const marks: Decoration[] = []
  const changes: Change[] = []
  const blocks = new Set<number>()
  for (const step of steps) {
    if (step.toB > step.fromB) {
      marks.push(Decoration.inline(step.fromB, step.toB, { class: 'change-inserted' }))
    }
    if (step.toA > step.fromA && !blank(base.slice(step.fromA, step.toA).content)) {
      const $from = base.resolve(step.fromA)
      if ($from.sameParent(base.resolve(step.toA)) && $from.parent.isTextblock) {
        marks.push(deletedText(base.textBetween(step.fromA, step.toA), step.fromB))
      } else {
        const content = base.slice(step.fromA, step.toA).content
        changes.push({ kind: 'removed', at: step.fromB, content, key: `${step.fromA}:${step.toA}` })
      }
    }
    changedBlocks(doc, step.fromB, step.toB).forEach((pos) => blocks.add(pos))
  }
  for (const from of blocks) {
    const to = from + doc.nodeAt(from)!.nodeSize
    const old = base.slice(toBase(steps, from, -1), toBase(steps, to, 1)).content
    changes.push({ kind: 'block', from, to, depth: listDepth(doc, from), old })
  }
  // Removed blocks are drawn before a block starting at the same position.
  const position = (c: Change) => (c.kind === 'block' ? c.from + 0.5 : c.at)
  changes.sort((a, b) => position(a) - position(b))
  return { marks, changes }
}

// Maps a position in the document to the base. A position inside a step
// maps to the step's start (side -1) or end (side 1) in the base, so a new
// block maps to an empty range.
function toBase(steps: readonly Step[], pos: number, side: -1 | 1): number {
  let offset = 0
  for (const step of steps) {
    if (pos < step.fromB || (pos === step.fromB && side < 0)) break
    if (pos < step.toB || (pos === step.toB && side < 0)) return side < 0 ? step.fromA : step.toA
    offset = step.toA - step.toB
  }
  return pos + offset
}

type Step = { fromA: number; toA: number; fromB: number; toB: number }

// Each change carries its index in data-change, for the header to refer to,
// and gets buttons in the gutter to show it as it is, as a diff or as it was.
function draw(doc: Node, diff: Diff, focus: Focus | undefined, shown: Map<number, View>): DecorationSet {
  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const decorations: Decoration[] = []
  const plain: { from: number; to: number }[] = [] // blocks not shown as a diff
  diff.changes.forEach((change, index) => {
    const view = shown.get(index) ?? 'diff'
    const current = focus?.index === index
    const classes = [`change-${change.kind}`]
    if (current) classes.push('change-current')
    if (current && focus.pulse) classes.push('change-pulse')
    const at = change.kind === 'block' ? change.from : change.at
    // Removed blocks come before a block at the same position: controls,
    // then what they control.
    const side = change.kind === 'block' ? -2 : -4
    decorations.push(controls(at, side, index, view, current, change.kind === 'block' ? change.depth : 0))

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
      const content = change.old.size ? change.old : 'Not in the old version'
      decorations.push(block(at, side + 1, index, classes, change.depth, content, serializer, `old:${change.from}`))
      return
    }
    const attrs = { class: classes.join(' '), style: `--list-depth: ${change.depth}`, 'data-change': String(index) }
    decorations.push(Decoration.node(change.from, change.to, attrs))
  })
  const inPlain = (d: Decoration) => plain.some((p) => d.from >= p.from && d.to <= p.to)
  return DecorationSet.create(doc, [...diff.marks.filter((d) => !inPlain(d)), ...decorations])
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
    key: `controls:${index}:${view}:${current}:${depth}`,
  })
}

// Deleted text within a block, shown struck through at `at`.
function deletedText(text: string, at: number): Decoration {
  const render = () => Object.assign(document.createElement('del'), { className: 'change-deleted', textContent: text })
  return Decoration.widget(at, render, { side: -1, ignoreSelection: true, key: `del:${text}` })
}

// The positions of the blocks holding from..to: textblocks and leaf blocks
// such as rules, so a change in a list marks its item, not the whole list.
function changedBlocks(doc: Node, from: number, to: number): number[] {
  if (from === to) {
    const $pos = doc.resolve(from)
    return $pos.parent.isTextblock ? [$pos.before()] : []
  }
  const blocks: number[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.isLeaf) blocks.push(pos)
    else if (node.isTextblock && !blank(node.content)) blocks.push(pos)
    return !node.isTextblock
  })
  return blocks
}

// How many list items hold pos, so the bar can line up with the others in
// the gutter.
function listDepth(doc: Node, pos: number): number {
  const $pos = doc.resolve(pos)
  let depth = 0
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'list_item') depth++
  }
  return depth
}

// Empty paragraphs come and go with editing, and the editor adds one after
// a trailing list; they aren't worth showing.
function blank(content: Fragment): boolean {
  let empty = content.textBetween(0, content.size).trim() === ''
  content.descendants((node) => {
    if (node.isLeaf && !node.isText) empty = false // a rule or an image
    return empty
  })
  return empty
}
