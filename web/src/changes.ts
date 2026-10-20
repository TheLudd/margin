// Changes (CH): what differs between the open document and its baseline, as
// changes at the grain of a paragraph, a bullet, a table row or a run of code
// lines, with the new words lit inside them, and how stepping through them
// works. Pure logic over units; the editor draws it.

export type UnitKind = 'paragraph' | 'heading' | 'code_block' | 'table' | 'hr' | 'html' | 'other'

/** A unit of a version: a paragraph, a heading, a bullet's own text, a code block, a table, a rule. */
export interface Unit {
  norm: string
  kind: UnitKind
  /** Plain text, for similarity and word diffs. */
  text: string
  /** A code block's lines. */
  lines?: string[]
  /** A table's rows of cell texts. */
  rows?: string[][]
}

export type Mark = 'same' | 'added' | 'modified'

export interface UnitMark {
  mark: Mark
  /** The baseline unit this one pairs with, for same and modified. */
  baseline?: number
}

export interface Removed {
  /** The baseline unit that is gone. */
  baseline: number
  /** Drawn before this current unit (units.length means at the end). */
  before: number
}

export interface Diff {
  units: UnitMark[]
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

/** The runs between matched pairs: [a0, a1, b0, b1) with something in them. */
function runs(pairs: [number, number][], n: number, m: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  let ai = 0
  let bi = 0
  for (const [pa, pb] of [...pairs, [n, m] as [number, number]]) {
    if (pa > ai || pb > bi) out.push([ai, pa, bi, pb])
    ai = pa + 1
    bi = pb + 1
  }
  return out
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k)
}

function textual(kind: UnitKind): boolean {
  return kind === 'paragraph' || kind === 'heading'
}

/** Pairs what two runs hold between two matches: by score in order, then
    what is left over one for one is a rewrite in place. The rest is gone. */
function pairRun(b0: number, b1: number, c0: number, c1: number, score: (b: number, c: number) => number, threshold: number): { pairs: [number, number][]; removed: Removed[] } {
  const found: [number, number][] = []
  let nextB = b0
  for (let c = c0; c < c1; c++) {
    let best = -1
    let bestScore = 0
    for (let b = nextB; b < b1; b++) {
      const sc = score(b, c)
      if (sc > bestScore && sc >= threshold) {
        best = b
        bestScore = sc
        if (sc >= 1) break
      }
    }
    if (best >= 0) {
      found.push([best, c])
      nextB = best + 1
    }
  }
  const pairs: [number, number][] = []
  const removed: Removed[] = []
  let bi = b0
  let ci = c0
  for (const [pb, pc] of [...found, [b1, c1] as [number, number]]) {
    const leftB = range(bi, pb)
    const leftC = range(ci, pc)
    if (leftB.length > 0 && leftB.length === leftC.length && leftB.every((b, k) => score(b, leftC[k]) >= 0)) {
      leftB.forEach((b, k) => pairs.push([b, leftC[k]]))
    } else {
      for (const b of leftB) removed.push({ baseline: b, before: ci })
    }
    if (pb < b1) pairs.push([pb, pc])
    bi = pb + 1
    ci = pc + 1
  }
  return { pairs, removed }
}

/** Compares the current units with the baseline's (CH-05). */
export function diffUnits(baseline: Unit[], current: Unit[]): Diff {
  const matched = lcs(
    baseline.map((b) => b.norm),
    current.map((c) => c.norm),
  )
  const units: UnitMark[] = current.map(() => ({ mark: 'added' }))
  const removed: Removed[] = []
  for (const [pb, pc] of matched) units[pc] = { mark: 'same', baseline: pb }
  // Text units pair by shared words; other kinds pair with the next of their
  // kind. Units of different kinds never pair, not even as a rewrite.
  const score = (b: number, c: number): number => {
    if (baseline[b].kind !== current[c].kind) return -1
    return textual(current[c].kind) ? similarity(baseline[b].text, current[c].text) : 1
  }
  for (const [b0, b1, c0, c1] of runs(matched, baseline.length, current.length)) {
    const run = pairRun(b0, b1, c0, c1, score, 0.4)
    for (const [b, c] of run.pairs) units[c] = { mark: 'modified', baseline: b }
    removed.push(...run.removed)
  }
  removed.sort((a, b) => a.baseline - b.baseline)
  return { units, removed }
}

/** A run of code lines that differs: [from, to) in the current block, [oldFrom, oldTo) in the baseline's. */
export interface Hunk {
  from: number
  to: number
  oldFrom: number
  oldTo: number
}

/** The hunks between two code blocks' lines (CH-05). */
export function diffLines(a: string[], b: string[]): Hunk[] {
  return runs(lcs(a, b), a.length, b.length).map(([oldFrom, oldTo, from, to]) => ({ from, to, oldFrom, oldTo }))
}

/** How the rows of two tables pair (CH-05). */
export interface RowDiff {
  /** Baseline row by current row, for the rows that pair. */
  paired: Map<number, number>
  /** Rows only in the current table. */
  added: number[]
  /** Baseline rows that are gone, each before a current row (rows.length means at the end). */
  removed: { baselineRow: number; before: number }[]
  /** Changed cells of paired rows, as `row,col` in the current table. */
  changed: Set<string>
}

export function diffRows(baselineRows: string[][], currentRows: string[][]): RowDiff {
  const matched = lcs(
    baselineRows.map((r) => r.join('\u0000')),
    currentRows.map((r) => r.join('\u0000')),
  )
  const paired = new Map<number, number>()
  for (const [b, c] of matched) paired.set(c, b)
  // Rows between the same matches pair by the cells they share, then one for one.
  const score = (b: number, c: number): number => {
    const base = baselineRows[b]
    const row = currentRows[c]
    const n = Math.max(base.length, row.length)
    return n === 0 ? 1 : row.filter((cell, col) => cell === base[col]).length / n
  }
  const removed: RowDiff['removed'] = []
  for (const [b0, b1, c0, c1] of runs(matched, baselineRows.length, currentRows.length)) {
    const run = pairRun(b0, b1, c0, c1, score, Number.MIN_VALUE)
    for (const [b, c] of run.pairs) paired.set(c, b)
    for (const r of run.removed) removed.push({ baselineRow: r.baseline, before: r.before })
  }
  removed.sort((a, b) => a.baselineRow - b.baselineRow)
  const added = currentRows.map((_, c) => c).filter((c) => !paired.has(c))
  const changed = new Set<string>()
  for (const [c, b] of paired) {
    const row = currentRows[c]
    const base = baselineRows[b]
    for (let col = 0; col < row.length; col++) {
      if (row[col] !== (base[col] ?? '')) changed.add(`${c},${col}`)
    }
  }
  return { paired, added, removed, changed }
}

/** One change: a unit that is new, changed or gone, or a run of lines or a row inside one (CH-06). */
export type Change = {
  /** Stable across edits while the file is open: by the baseline unit when there is one. */
  key: string
  /** The key a view is picked by: changes inside a code block or table share the block's. */
  viewKey: string
  /** The current unit the change is in, or the one a removed unit sits before (units.length means at the end). */
  unit: number
} & (
  | { kind: 'added' }
  | { kind: 'modified'; baseline: number }
  | { kind: 'removed'; baseline: number }
  | { kind: 'lines'; baseline: number; hunk: Hunk }
  | { kind: 'row'; baseline: number; row: number; baselineRow: number | null; cells: number[] }
  | { kind: 'row-removed'; baseline: number; baselineRow: number; before: number }
)

/** The changes in document order (CH-05, CH-06). */
export function listChanges(diff: Diff, baseline: Unit[], current: Unit[]): Change[] {
  const out: Change[] = []
  const removedBefore = new Map<number, Removed[]>()
  for (const r of diff.removed) removedBefore.set(r.before, [...(removedBefore.get(r.before) ?? []), r])
  for (let i = 0; i <= current.length; i++) {
    for (const r of removedBefore.get(i) ?? []) out.push({ kind: 'removed', key: 'b' + r.baseline, viewKey: 'b' + r.baseline, unit: i, baseline: r.baseline })
    if (i >= current.length) break
    const mark = diff.units[i]
    if (mark.mark === 'same') continue
    if (mark.mark === 'added' || mark.baseline === undefined) {
      out.push({ kind: 'added', key: 'c' + i, viewKey: 'c' + i, unit: i })
      continue
    }
    out.push(...insideChanges(i, mark.baseline, baseline[mark.baseline], current[i]))
  }
  return out
}

/** A modified unit's changes: its hunks, its rows, or the unit itself. */
function insideChanges(i: number, b: number, old: Unit, now: Unit): Change[] {
  const viewKey = 'b' + b
  if (old.lines && now.lines) {
    const hunks = diffLines(old.lines, now.lines)
    if (hunks.length > 0) return hunks.map((hunk) => ({ kind: 'lines', key: `${viewKey}h${hunk.oldFrom}`, viewKey, unit: i, baseline: b, hunk }))
  }
  if (old.rows && now.rows) {
    const rows = diffRows(old.rows, now.rows)
    const out: Change[] = []
    const byRow = new Map<number, Change>()
    for (const r of rows.removed) byRow.set(r.before, { kind: 'row-removed', key: `${viewKey}r${r.baselineRow}`, viewKey, unit: i, baseline: b, baselineRow: r.baselineRow, before: r.before })
    for (let row = 0; row <= now.rows.length; row++) {
      const gone = byRow.get(row)
      if (gone) out.push(gone)
      if (row >= now.rows.length) break
      if (rows.added.includes(row)) out.push({ kind: 'row', key: `c${i}r${row}`, viewKey, unit: i, baseline: b, row, baselineRow: null, cells: now.rows[row].map((_, col) => col) })
      else {
        const cells = now.rows[row].map((_, col) => col).filter((col) => rows.changed.has(`${row},${col}`))
        if (cells.length > 0) out.push({ kind: 'row', key: `${viewKey}r${rows.paired.get(row)}`, viewKey, unit: i, baseline: b, row, baselineRow: rows.paired.get(row) ?? null, cells })
      }
    }
    if (out.length > 0) return out
  }
  return [{ kind: 'modified', key: viewKey, viewKey, unit: i, baseline: b }]
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
  const raw: WordOp[] = []
  let i = 0
  let j = 0
  const push = (kind: WordOp['kind'], text: string) => {
    const last = raw[raw.length - 1]
    if (last && last.kind === kind) last.text += text
    else raw.push({ kind, text })
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
  return fold(raw)
}

/** Whitespace kept between two edits reads better as part of them: the
    deleted words run on, and so do the inserted ones. */
function fold(ops: WordOp[]): WordOp[] {
  const out: WordOp[] = []
  let region: { del: string; ins: string } | null = null
  let gap = ''
  const flush = () => {
    if (!region) return
    if (region.del) out.push({ kind: 'delete', text: region.del })
    if (region.ins) out.push({ kind: 'insert', text: region.ins })
    region = null
  }
  for (const op of ops) {
    if (op.kind === 'same') {
      if (region && /^\s+$/.test(op.text) && !gap) {
        gap = op.text
        continue
      }
      flush()
      if (gap) out.push({ kind: 'same', text: gap + op.text })
      else out.push({ kind: 'same', text: op.text })
      gap = ''
      continue
    }
    if (!region) region = { del: '', ins: '' }
    else if (gap) {
      if (region.del) region.del += gap
      if (region.ins) region.ins += gap
      gap = ''
    }
    if (op.kind === 'delete') region.del += op.text
    else region.ins += op.text
  }
  flush()
  if (gap) out.push({ kind: 'same', text: gap })
  return out
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
