// Shows how the document differs from a base version of it: inserted text
// is highlighted, deleted text is shown struck through where it was, and
// every changed block gets a bar in the gutter. The document itself is
// never touched, so it stays editable and the changes follow edits.

import { computeDocDiff } from '@milkdown/kit/plugin/diff'
import { simplifyChanges } from '@milkdown/kit/prose/changeset'
import { DOMSerializer, type Fragment, type Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

interface ChangesState {
  base?: Node
  decorations: DecorationSet
}

export const changesKey = new PluginKey<ChangesState>('changes')

// The transaction meta that sets the base; undefined stops comparing.
export interface SetBase {
  base?: Node
}

// onUpdate is called whenever the changes shown are recomputed.
export function changesPlugin(onUpdate: () => void): Plugin<ChangesState> {
  return new Plugin<ChangesState>({
    key: changesKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply(tr, value, _, state) {
        const meta = tr.getMeta(changesKey) as SetBase | undefined
        if (!meta && !tr.docChanged) return value
        const base = meta ? meta.base : value.base
        return { base, decorations: base ? decorate(base, state.doc) : DecorationSet.empty }
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

export function decorate(base: Node, doc: Node): DecorationSet {
  let changes
  try {
    // Widened to whole words, which read better than single characters.
    changes = simplifyChanges(computeDocDiff(base, doc, { ignoreAttrs }), doc)
  } catch {
    return DecorationSet.empty
  }
  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const decorations: Decoration[] = []
  const blocks = new Set<number>()
  for (const change of changes) {
    if (change.toB > change.fromB) {
      decorations.push(Decoration.inline(change.fromB, change.toB, { class: 'change-inserted' }))
    }
    if (change.toA > change.fromA && !blank(base.slice(change.fromA, change.toA).content)) {
      decorations.push(deleted(base, change.fromA, change.toA, change.fromB, serializer))
    }
    changedBlocks(doc, change.fromB, change.toB).forEach((pos) => blocks.add(pos))
  }
  for (const pos of blocks) {
    const attrs = { class: 'change-block', style: `--list-depth: ${listDepth(doc, pos)}` }
    decorations.push(Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, attrs))
  }
  return DecorationSet.create(doc, decorations)
}

// The deleted range from..to of base, shown at `at`: inline as struck text
// when it lies within one block, or as the removed blocks otherwise.
function deleted(base: Node, from: number, to: number, at: number, serializer: DOMSerializer): Decoration {
  const $from = base.resolve(from)
  const $to = base.resolve(to)
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    const text = base.textBetween(from, to)
    const render = () => Object.assign(document.createElement('del'), { className: 'change-deleted', textContent: text })
    return Decoration.widget(at, render, { side: -1, ignoreSelection: true, key: `del:${text}` })
  }
  const render = () => {
    const removed = document.createElement('div')
    removed.className = 'change-removed'
    removed.contentEditable = 'false'
    removed.append(serializer.serializeFragment(base.slice(from, to).content))
    return removed
  }
  return Decoration.widget(at, render, { side: -1, ignoreSelection: true, key: `removed:${from}:${to}` })
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
