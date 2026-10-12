// How a document differs from a base version of it, block by block. A
// block is a paragraph, heading, list item's paragraph, code block, image
// or rule; a table is one block, as a bar can't sit beside a cell.
//
// The blocks of both versions are lined up first, so a new block is told
// from a changed one; only then are a changed block's words compared.

import { computeDocDiff } from '@milkdown/kit/plugin/diff'
import { simplifyChanges } from '@milkdown/kit/prose/changeset'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { align, type Similarity } from './align'

// A changed block, with what it was, whether it is new, and its changed
// cells if it is a table; or the blocks removed at a position. Changes
// close together form one group, which is what the reader counts and steps
// through. A stacked block is shown as a diff as it was above as it is,
// rather than word by word: it is rewritten, or code or a table, whose
// changes don't read well word by word.
export type Change = { group: number } & (
  | { kind: 'block'; from: number; to: number; depth: number; old: Fragment; added: boolean; stacked: boolean; cells: Cell[] }
  | { kind: 'removed'; at: number; content: Fragment; key: string }
)

// A changed table cell; added when its whole row is new.
export interface Cell {
  from: number
  to: number
  added: boolean
}

// Inserted text, or deleted text shown where it was, in a block whose
// changes are shown word by word.
export type Mark = { kind: 'inserted'; from: number; to: number } | { kind: 'deleted'; at: number; content: Fragment }

export interface Diff {
  marks: Mark[] // shown in a diff, within the changes
  changes: Change[] // in document order
}

export const noDiff: Diff = { marks: [], changes: [] }

// How many unchanged blocks may separate two changes of one group. Edits
// tend to touch a few neighbouring blocks, such as a new section and the
// one after it, which read as one change.
export const maxGap = 1

// The share of a block's text that must be unchanged for its changes to be
// shown word by word. Below it, the struck-through and highlighted words
// alternate so much that neither version can be read.
export const minKept = 0.5

// A block and where it starts.
interface Block {
  node: Node
  pos: number
}

export function compare(base: Node, doc: Node): Diff {
  const marks: Mark[] = []
  const changes: Change[] = []
  let removed: Block[] = [] // waiting for the block after them
  let previous: Block | undefined // the last block of doc passed
  const flush = (next: Block | undefined) => {
    if (removed.length === 0) return
    const content = Fragment.from(removed.map((b) => b.node))
    const last = removed[removed.length - 1]
    changes.push({ kind: 'removed', at: removedAt(doc, previous, next), content, key: `${removed[0].pos}:${last.pos + last.node.nodeSize}`, group: 0 })
    removed = []
  }
  for (const step of align(blocks(base), blocks(doc), (a, b) => sameBlock(a.node, b.node), similar)) {
    if (step.kind === 'removed') {
      removed.push(step.before)
      continue
    }
    flush(step.after)
    previous = step.after
    if (step.kind === 'added') changes.push(block(doc, step.after, Fragment.empty, { added: true, stacked: false }))
    if (step.kind === 'changed') changed(doc, step.before, step.after, changes, marks)
  }
  flush(undefined)
  group(doc, changes)
  return { marks, changes }
}

function block(doc: Node, { node, pos }: Block, old: Fragment, how: { added: boolean; stacked: boolean; cells?: Cell[] }): Change {
  return { kind: 'block', from: pos, to: pos + node.nodeSize, depth: listDepth(doc, pos), old, cells: [], ...how, group: 0 }
}

// Adds the change from before to after: word by word when it is text and
// enough of it is kept, otherwise stacked.
function changed(doc: Node, before: Block, after: Block, changes: Change[], marks: Mark[]) {
  const old = Fragment.from(before.node)
  const node = after.node
  if (!words(node) || !words(before.node)) {
    const cells = node.type.name === 'table' ? changedCells(before.node, after) : []
    changes.push(block(doc, after, old, { added: false, stacked: true, cells }))
    return
  }
  const steps = wordSteps(before.node, node)
  const restyled = before.node.type !== node.type || !sameAttrs(before.node, node)
  if (steps.length === 0 && !restyled) return // only whitespace moved
  // Positions in the documents wordSteps compares are offset by the block's.
  const a = wrap(before.node)
  const b = wrap(node)
  const inserted = steps.reduce((n, s) => n + s.toB - s.fromB, 0)
  const stacked = restyled || rewritten(node, before.node, inserted)
  changes.push(block(doc, after, old, { added: false, stacked }))
  if (stacked) return
  for (const step of steps) {
    if (step.toA > step.fromA && inTextblock(a, step.fromA, step.toA) && !blank(a.slice(step.fromA, step.toA).content)) {
      const $from = a.resolve(step.fromA)
      const content = $from.parent.content.cut($from.parentOffset, $from.parentOffset + step.toA - step.fromA)
      marks.push({ kind: 'deleted', at: after.pos + step.fromB, content })
    }
    if (step.toB > step.fromB && inTextblock(b, step.fromB, step.toB)) {
      marks.push({ kind: 'inserted', from: after.pos + step.fromB, to: after.pos + step.toB })
    }
  }
}

// Heading ids are derived from their text, so they only add noise.
const ignoreAttrs = { heading: ['id'] }

// The word changes from one textblock to another, as positions in each
// wrapped in a document of its own, where the block starts at 0.
function wordSteps(before: Node, after: Node): Step[] {
  const a = wrap(before)
  const b = wrap(after)
  try {
    // Widened to whole words, which read better than single characters.
    const steps = simplifyChanges(computeDocDiff(a, b, { ignoreAttrs }), b)
    return merge(a, b, steps.filter((step) => !whitespaceOnly(a, b, step)))
  } catch {
    return []
  }
}

function wrap(node: Node): Node {
  return node.type.schema.topNodeType.create(null, node)
}

type Step = { fromA: number; toA: number; fromB: number; toB: number }

// Joins changes within a block that only a little unchanged text separates,
// such as one word between two replaced ones, so the reader sees one
// deletion and one insertion rather than a patchwork. As in
// diff-match-patch's semantic cleanup, the unchanged text is absorbed when
// it is no longer than the changes on either side of it.
function merge(base: Node, doc: Node, steps: readonly Step[]): Step[] {
  const merged: Step[] = []
  for (const step of steps) {
    const previous = merged[merged.length - 1]
    if (previous && absorbs(base, doc, previous, step)) {
      merged[merged.length - 1] = { fromA: previous.fromA, toA: step.toA, fromB: previous.fromB, toB: step.toB }
    } else {
      merged.push({ fromA: step.fromA, toA: step.toA, fromB: step.fromB, toB: step.toB })
    }
  }
  return merged
}

function absorbs(base: Node, doc: Node, a: Step, b: Step): boolean {
  if (!inTextblock(doc, a.toB, b.fromB) || !inTextblock(base, a.toA, b.fromA)) return false
  const gap = doc.textBetween(a.toB, b.fromB).trim().length
  const size = (s: Step) => Math.max(s.toA - s.fromA, s.toB - s.fromB)
  return gap <= size(a) && gap <= size(b)
}

// Whitespace that comes or goes within a block, such as a space moved out
// of inline code, changes nothing the reader sees.
function whitespaceOnly(base: Node, doc: Node, step: Step): boolean {
  return (
    inTextblock(base, step.fromA, step.toA) &&
    inTextblock(doc, step.fromB, step.toB) &&
    blank(base.slice(step.fromA, step.toA).content) &&
    blank(doc.slice(step.fromB, step.toB).content)
  )
}

function inTextblock(node: Node, from: number, to: number): boolean {
  const $from = node.resolve(from)
  return $from.parent.isTextblock && $from.sameParent(node.resolve(to))
}

// Whether too little of a textblock's text is unchanged to show its changes
// word by word; inserted is how much of it is new.
function rewritten(node: Node, old: Node, inserted: number): boolean {
  const before = old.content.size
  const after = node.content.size
  const kept = Math.max(0, after - inserted)
  return 2 * kept < minKept * (before + after)
}

// The blocks of a document, in order: textblocks, tables and leaf blocks
// such as rules, so a change in a list marks its item, not the whole list.
function blocks(doc: Node): Block[] {
  const found: Block[] = []
  doc.descendants((node, pos) => {
    if (counts(node)) found.push({ node, pos })
    return !whole(node)
  })
  return found
}

// Whether a node changes as a whole: a textblock, or a table, whose cells
// are no blocks of their own.
function whole(node: Node): boolean {
  return node.isTextblock || node.type.name === 'table'
}

// Whether a node is a block whose changes are shown. Empty paragraphs come
// and go with editing, and the editor adds one after a trailing list or
// table; they aren't worth showing.
function counts(node: Node): boolean {
  return (node.isBlock && node.isLeaf) || node.type.name === 'table' || (node.isTextblock && !blank(node.content))
}

// Whether a block's changes can be shown word by word.
function words(node: Node): boolean {
  return node.isTextblock && !node.type.spec.code
}

function sameBlock(a: Node, b: Node): boolean {
  return a.type === b.type && sameAttrs(a, b) && a.content.eq(b.content)
}

function sameAttrs(a: Node, b: Node): boolean {
  const ignored = ignoreAttrs[a.type.name as keyof typeof ignoreAttrs] ?? []
  return Object.keys(a.attrs).every((key) => ignored.includes(key) || a.attrs[key] === b.attrs[key])
}

// How alike two blocks are, by the words they share. Text pairs with text,
// and anything else with its own kind only.
const similar: Similarity<Block> = ({ node: a }, { node: b }) => {
  if (words(a) !== words(b) || (!words(a) && a.type !== b.type)) return -1
  const before = tokens(a)
  const after = tokens(b)
  if (before.length + after.length === 0) return 1
  const counts = new Map<string, number>()
  for (const token of before) counts.set(token, (counts.get(token) ?? 0) + 1)
  let shared = 0
  for (const token of after) {
    const n = counts.get(token) ?? 0
    if (n > 0) shared++, counts.set(token, n - 1)
  }
  return (2 * shared) / (before.length + after.length)
}

// The words of a block, with its images and other leaves as words of
// their own.
function tokens(node: Node): string[] {
  return node.textBetween(0, node.content.size, ' ', (leaf) => ` <${leaf.type.name}> `).split(/\s+/).filter(Boolean)
}

// Where blocks removed between previous and next are shown: before the
// outermost block holding next that doesn't hold previous, so a removed
// paragraph after a list shows after it, not in its last item.
function removedAt(doc: Node, previous: Block | undefined, next: Block | undefined): number {
  if (!next) {
    if (!previous) return 0
    const $end = doc.resolve(previous.pos + previous.node.nodeSize)
    return $end.depth === 0 ? $end.pos : $end.after(1)
  }
  const $next = doc.resolve(next.pos)
  const shared = previous ? $next.sharedDepth(previous.pos + previous.node.nodeSize) : 0
  return shared >= $next.depth ? next.pos : $next.before(shared + 1)
}

// The cells of a table that differ from the old version of it. Rows are
// lined up as blocks are; a changed row's cells are compared by column.
function changedCells(old: Node, table: Block): Cell[] {
  const cells: Cell[] = []
  const steps = align(rows(old, 0), rows(table.node, table.pos), (a, b) => sameRow(a.node, b.node), () => 1)
  for (const step of steps) {
    if (step.kind === 'same' || step.kind === 'removed') continue
    const before = step.kind === 'changed' ? step.before.node : undefined
    let pos = step.after.pos + 1
    step.after.node.forEach((cell, _, k) => {
      if (!before?.maybeChild(k)?.content.eq(cell.content)) cells.push({ from: pos, to: pos + cell.nodeSize, added: !before })
      pos += cell.nodeSize
    })
  }
  return cells
}

function rows(table: Node, pos: number): Block[] {
  const found: Block[] = []
  table.forEach((node, offset) => found.push({ node, pos: pos + 1 + offset }))
  return found
}

function sameRow(a: Node, b: Node): boolean {
  if (a.childCount !== b.childCount) return false
  for (let k = 0; k < a.childCount; k++) if (!a.child(k).content.eq(b.child(k).content)) return false
  return true
}

// Numbers the groups of changes, in document order: a change joins the
// group before it unless more than maxGap unchanged blocks lie between.
function group(doc: Node, changes: Change[]) {
  const start = (c: Change) => (c.kind === 'block' ? c.from : c.at)
  const end = (c: Change) => (c.kind === 'block' ? c.to : c.at)
  changes.forEach((change, i) => {
    const previous = changes[i - 1]
    if (!previous) return
    const apart = start(change) > end(previous) && blocksBetween(doc, end(previous), start(change)) > maxGap
    change.group = previous.group + (apart ? 1 : 0)
  })
}

// How many blocks lie within from..to.
function blocksBetween(doc: Node, from: number, to: number): number {
  let count = 0
  doc.nodesBetween(from, to, (node, pos) => {
    if (pos < from || pos + node.nodeSize > to) return !whole(node) // partly outside
    if (counts(node)) count++
    return !whole(node)
  })
  return count
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

// Whether content has no text and no leaf such as a rule or an image.
function blank(content: Fragment): boolean {
  let empty = content.textBetween(0, content.size).trim() === ''
  content.descendants((node) => {
    if (node.isLeaf && !node.isText) empty = false
    return empty
  })
  return empty
}
