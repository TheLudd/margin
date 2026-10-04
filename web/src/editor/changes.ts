// Shows how the document differs from a base version of it: inserted text
// is highlighted, deleted text is shown struck through where it was, and
// every changed block gets a bar in the gutter. The document itself is
// never touched, so it stays editable and the changes follow edits.

import { computeDocDiff } from '@milkdown/kit/plugin/diff'
import { simplifyChanges } from '@milkdown/kit/prose/changeset'
import { DOMSerializer, type Fragment, type Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

// A change the reader steps through: a changed block, or the blocks
// removed at a position.
type Change =
  | { kind: 'block'; from: number; to: number; depth: number }
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

interface ChangesState {
  base?: Node
  diff: Diff
  focus?: Focus
  decorations: DecorationSet
}

// The transaction meta: a new base (undefined stops comparing), or a new
// current change.
export type ChangesMeta = { base?: Node } | { focus?: Focus }

export const changesKey = new PluginKey<ChangesState>('changes')

const noDiff: Diff = { marks: [], changes: [] }

// onUpdate is called whenever the changes shown are redrawn.
export function changesPlugin(onUpdate: () => void): Plugin<ChangesState> {
  return new Plugin<ChangesState>({
    key: changesKey,
    state: {
      init: () => ({ diff: noDiff, decorations: DecorationSet.empty }),
      apply(tr, value, _, state) {
        const meta = tr.getMeta(changesKey) as ChangesMeta | undefined
        if (!meta && !tr.docChanged) return value
        let { base, diff, focus } = value
        if (meta && 'focus' in meta) {
          focus = meta.focus
        } else {
          if (meta && 'base' in meta) base = meta.base
          diff = base ? compare(base, state.doc) : noDiff
        }
        return { base, diff, focus, decorations: draw(state.doc, diff, focus) }
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
  for (const pos of blocks) {
    changes.push({ kind: 'block', from: pos, to: pos + doc.nodeAt(pos)!.nodeSize, depth: listDepth(doc, pos) })
  }
  // Removed blocks are drawn before a block starting at the same position.
  const position = (c: Change) => (c.kind === 'block' ? c.from + 0.5 : c.at)
  changes.sort((a, b) => position(a) - position(b))
  return { marks, changes }
}

// Each change carries its index in data-change, for the header to refer to.
function draw(doc: Node, diff: Diff, focus: Focus | undefined): DecorationSet {
  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const changes = diff.changes.map((change, index) => {
    const classes = [`change-${change.kind}`]
    if (focus?.index === index) classes.push('change-current')
    if (focus?.index === index && focus.pulse) classes.push('change-pulse')
    const className = classes.join(' ')
    if (change.kind === 'block') {
      const attrs = { class: className, style: `--list-depth: ${change.depth}`, 'data-change': String(index) }
      return Decoration.node(change.from, change.to, attrs)
    }
    const render = () => {
      const removed = document.createElement('div')
      removed.className = className
      removed.dataset.change = String(index)
      removed.contentEditable = 'false'
      removed.append(serializer.serializeFragment(change.content))
      return removed
    }
    return Decoration.widget(change.at, render, { side: -1, ignoreSelection: true, key: `removed:${change.key}:${className}` })
  })
  return DecorationSet.create(doc, [...diff.marks, ...changes])
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
