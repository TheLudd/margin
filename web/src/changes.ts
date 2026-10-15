// Changes (CH): what differs between the open document and its baseline,
// grouped into changes, with word diffs and table cells, and how stepping
// through them works. Pure logic over blocks; the editor draws it.

export type BlockKind = 'paragraph' | 'heading' | 'code_block' | 'table' | 'list' | 'blockquote' | 'hr' | 'html' | 'other'

/** A top-level block of a version, by its normal form. */
export interface Block {
  norm: string
  kind: BlockKind
  /** Plain text, for similarity and word diffs. */
  text: string
}

export type Mark = 'same' | 'added' | 'modified'

export interface BlockMark {
  mark: Mark
  /** The baseline block this one pairs with, for same and modified. */
  baseline?: number
}

export interface Removed {
  /** The baseline block that is gone. */
  baseline: number
  /** Drawn before this current block (current.length means at the end). */
  before: number
}

export interface Diff {
  blocks: BlockMark[]
  removed: Removed[]
}

/** Similarity of two texts by shared words, 0 to 1. */
export function similarity(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  if (wa.length === 0 && wb.length === 0) return 1
  if (wa.length === 0 || wb.length === 0) return 0
  const count = new Map<string, number>()
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of wb) {
    const n = count.get(w) ?? 0
    if (n > 0) {
      shared++
      count.set(w, n - 1)
    }
  }
  return (2 * shared) / (wa.length + wb.length)
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Longest common subsequence of two sequences of keys, as index pairs. */
export function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const table: Uint32Array[] = []
  for (let i = 0; i <= n; i++) table.push(new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return out
}

/** Compares the current blocks with the baseline's (CH-05). */
export function diffBlocks(baseline: Block[], current: Block[]): Diff {
  const pairs = lcs(
    baseline.map((b) => b.norm),
    current.map((c) => c.norm),
  )
  const blocks: BlockMark[] = current.map(() => ({ mark: 'added' }))
  const removed: Removed[] = []
  let bi = 0
  let ci = 0
  const runs: [number, number, number, number][] = []
  for (const [pb, pc] of [...pairs, [baseline.length, current.length] as [number, number]]) {
    if (pb > bi || pc > ci) runs.push([bi, pb, ci, pc])
    if (pb < baseline.length) blocks[pc] = { mark: 'same', baseline: pb }
    bi = pb + 1
    ci = pc + 1
  }
  for (const [b0, b1, c0, c1] of runs) {
    // Pair modified blocks in order: text blocks need enough shared words,
    // other kinds pair with the next block of their kind. Baseline blocks
    // left over are removed, drawn where the baseline had them: right
    // after the last paired block.
    let nextB = b0
    let cursor = c0
    for (let c = c0; c < c1; c++) {
      let best = -1
      let bestScore = 0
      for (let b = nextB; b < b1; b++) {
        if (baseline[b].kind !== current[c].kind) continue
        const textual = baseline[b].kind === 'paragraph' || baseline[b].kind === 'heading'
        const score = textual ? similarity(baseline[b].text, current[c].text) : 1
        if (score > bestScore && score >= 0.4) {
          best = b
          bestScore = score
          if (!textual) break
        }
      }
      if (best >= 0) {
        blocks[c] = { mark: 'modified', baseline: best }
        for (let b = nextB; b < best; b++) removed.push({ baseline: b, before: cursor })
        nextB = best + 1
        cursor = c + 1
      }
    }
    for (let b = nextB; b < b1; b++) removed.push({ baseline: b, before: cursor })
  }
  removed.sort((a, b) => a.baseline - b.baseline)
  return { blocks, removed }
}

/** One change: marked blocks and removals with at most one unchanged block between (CH-06). */
export interface Change {
  /** Current block indices in the change. */
  blocks: number[]
  /** Removed baseline blocks in the change. */
  removed: number[]
  /** The first current block index at or after the change starts, for positioning. */
  start: number
  /** A key stable across edits while the file is open: the first baseline block involved. */
  key: string
}

export function groupChanges(diff: Diff): Change[] {
  type Item = { kind: 'block'; index: number; baseline?: number } | { kind: 'removed'; before: number; baseline: number }
  const items: Item[] = []
  const removedBefore = new Map<number, Removed[]>()
  for (const r of diff.removed) removedBefore.set(r.before, [...(removedBefore.get(r.before) ?? []), r])
  for (let i = 0; i <= diff.blocks.length; i++) {
    for (const r of removedBefore.get(i) ?? []) items.push({ kind: 'removed', before: i, baseline: r.baseline })
    if (i < diff.blocks.length) items.push({ kind: 'block', index: i, baseline: diff.blocks[i].baseline })
  }
  const changes: Change[] = []
  let current: Change | null = null
  let unchangedSince = 0
  for (const it of items) {
    const marked = it.kind === 'removed' || diff.blocks[it.index].mark !== 'same'
    if (!marked) {
      unchangedSince++
      continue
    }
    if (current && unchangedSince <= 1) {
      // Still the same change.
    } else {
      current = { blocks: [], removed: [], start: it.kind === 'removed' ? it.before : it.index, key: '' }
      changes.push(current)
    }
    unchangedSince = 0
    if (it.kind === 'removed') current.removed.push(it.baseline)
    else current.blocks.push(it.index)
  }
  for (const c of changes) {
    const baselines = [...c.removed, ...c.blocks.map((i) => diff.blocks[i].baseline).filter((b): b is number => b !== undefined)]
    c.key = baselines.length > 0 ? 'b' + Math.min(...baselines) : 'c' + c.start
  }
  return changes
}

/** A word-level diff of two texts (CH-08). */
export type WordOp = { kind: 'same' | 'insert' | 'delete'; text: string }

function tokens(s: string): string[] {
  return s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? []
}

export function diffWords(a: string, b: string): WordOp[] {
  const ta = tokens(a)
  const tb = tokens(b)
  const pairs = lcs(ta, tb)
  const out: WordOp[] = []
  let i = 0
  let j = 0
  const push = (kind: WordOp['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  for (const [pa, pb] of [...pairs, [ta.length, tb.length] as [number, number]]) {
    while (i < pa) push('delete', ta[i++])
    while (j < pb) push('insert', tb[j++])
    if (pa < ta.length) {
      push('same', ta[pa])
      i = pa + 1
      j = pb + 1
    }
  }
  // Whitespace-only changes next to real ones read better folded in.
  return out
}

/** Which cells of a table changed or are in new rows (CH-05). */
export interface TableMarks {
  /** Changed cells by [row][col] in the current table. */
  changed: Set<string>
  /** Rows only in the current table. */
  addedRows: Set<number>
}

export function diffTable(baselineRows: string[][], currentRows: string[][]): TableMarks {
  const changed = new Set<string>()
  const addedRows = new Set<number>()
  const pairs = lcs(
    baselineRows.map((r) => r.join('\u0000')),
    currentRows.map((r) => r.join('\u0000')),
  )
  const paired = new Map<number, number>()
  for (const [b, c] of pairs) paired.set(c, b)
  // Unpaired rows pair by order with unpaired baseline rows.
  const unpairedB = baselineRows.map((_, i) => i).filter((i) => !pairs.some(([b]) => b === i))
  let k = 0
  for (let c = 0; c < currentRows.length; c++) {
    if (paired.has(c)) continue
    if (k < unpairedB.length && isBetween(unpairedB[k], pairs, c)) paired.set(c, unpairedB[k++])
    else addedRows.add(c)
  }
  for (const [c, b] of paired) {
    const row = currentRows[c]
    const base = baselineRows[b]
    for (let col = 0; col < row.length; col++) {
      if (row[col] !== (base[col] ?? '')) changed.add(`${c},${col}`)
    }
  }
  return { changed, addedRows }
}

function isBetween(b: number, pairs: [number, number][], c: number): boolean {
  let lo = -1
  let hi = Infinity
  for (const [pb, pc] of pairs) {
    if (pc < c) lo = Math.max(lo, pb)
    if (pc > c) hi = Math.min(hi, pb)
  }
  return b > lo && b < hi
}

/** Stepping through changes (CH-07) by their positions on screen. */
export interface Placed {
  top: number
  bottom: number
}

export function nextChange(placed: Placed[], current: number, viewTop: number, viewBottom: number): number {
  if (placed.length === 0) return -1
  if (current >= 0) return Math.min(placed.length - 1, current + 1)
  const middle = (viewTop + viewBottom) / 2
  const i = placed.findIndex((p) => p.top > middle)
  return i < 0 ? placed.length - 1 : i
}

export function prevChange(placed: Placed[], current: number, viewTop: number, viewBottom: number): number {
  if (placed.length === 0) return -1
  if (current >= 0) return Math.max(0, current - 1)
  const middle = (viewTop + viewBottom) / 2
  let found = -1
  placed.forEach((p, i) => {
    if (p.bottom < middle) found = i
  })
  return found < 0 ? 0 : found
}

/** Whether a change is still on screen. */
export function onScreen(p: Placed, viewTop: number, viewBottom: number): boolean {
  return p.bottom > viewTop && p.top < viewBottom
}

/** The count line in the header (CH-06, CH-07). */
export function countLabel(n: number, baseline: 'read' | 'head', current: number): string {
  if (current >= 0) return `Change ${current + 1} of ${n}`
  const what = baseline === 'read' ? 'unread' : 'uncommitted'
  return n === 1 ? `1 ${what} change` : `${n} ${what} changes`
}
