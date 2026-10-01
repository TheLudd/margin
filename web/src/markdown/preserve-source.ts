// The editor serializes the whole document, normalizing formatting the user
// never touched (bullet markers, table padding, escapes). preserveSource
// keeps the original text of every top-level block whose content didn't
// change, so a one-word edit produces a one-block diff.

import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

interface Block {
  key: string
  start: number
  end: number
}

export function preserveSource(original: string, edited: string): string {
  const before = blocks(original)
  const after = blocks(edited)
  if (before.length === 0 && after.length === 0) return original
  if (before.length === 0 || after.length === 0) return edited

  const match = matchBlocks(
    before.map((b) => b.key),
    after.map((b) => b.key),
  )
  const source = (j: number) => {
    const i = match[j]
    return i >= 0 ? original.slice(before[i].start, before[i].end) : edited.slice(after[j].start, after[j].end)
  }
  // Keep the original gap between blocks that were adjacent originally.
  const gap = (j: number) => {
    const i = match[j]
    return i > 0 && match[j - 1] === i - 1
      ? original.slice(before[i - 1].end, before[i].start)
      : edited.slice(after[j - 1].end, after[j].start)
  }

  const last = after.length - 1
  let out = match[0] === 0 ? original.slice(0, before[0].start) : edited.slice(0, after[0].start)
  for (let j = 0; j <= last; j++) {
    if (j > 0) out += gap(j)
    out += source(j)
  }
  out += match[last] === before.length - 1 ? original.slice(before[before.length - 1].end) : edited.slice(after[last].end)
  return out
}

function blocks(markdown: string): Block[] {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  return tree.children.map((node) => ({
    key: keyOf(node),
    start: node.position!.start.offset!,
    end: node.position!.end.offset!,
  }))
}

// A block's identity is its structure, not how it was written: `*` and `-`
// bullets, `\[` and `[`, or differently indented continuation lines give
// the same key.
function keyOf(node: Nodes): string {
  return JSON.stringify(node, (name, value) => {
    if (name === 'position') return undefined
    if (value?.type === 'text') return { ...value, value: value.value.replace(/[ \t]*\n[ \t]*/g, '\n') }
    if (value?.type === 'tableRow') return { ...value, children: withoutTrailingEmptyCells(value.children) }
    return value
  })
}

// GFM pads short table rows with empty cells; the editor writes them out.
function withoutTrailingEmptyCells(cells: Nodes[]): Nodes[] {
  let end = cells.length
  while (end > 0 && 'children' in cells[end - 1] && (cells[end - 1] as { children: unknown[] }).children.length === 0) end--
  return cells.slice(0, end)
}

// For each block in `after`, the index of the block in `before` it keeps,
// or -1 for a new or changed block. Uses the longest common subsequence.
export function matchBlocks(before: string[], after: string[]): number[] {
  const n = before.length
  const m = after.length
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const match = new Array<number>(m).fill(-1)
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (before[i] === after[j]) match[j++] = i++
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++
    else j++
  }
  return match
}
