// Byte-preserving saves (D-04): every block not touched keeps its original
// bytes. Blocks are matched by structure, not position.

/** A top-level block of the original file. */
export interface OriginalBlock {
  start: number
  end: number
  bytes: string
  /** The block's normal form, or null when it yields no editor block. */
  norm: string | null
}

export interface Position {
  start: { offset: number }
  end: { offset: number }
}

export interface BlockInfo {
  position: Position
  /** A link or footnote definition, which yields no editor block. */
  definition: boolean
  /** The definition's normalized label. */
  identifier?: string
}

export interface Tools {
  /** The positions of the top-level blocks, and which of them are definitions. */
  blocks(source: string): BlockInfo[]
  /** The normal forms of the editor blocks a piece of markdown yields. */
  norms(markdown: string): string[]
}

/** A reference label as remark normalizes it. */
export function normalizeLabel(label: string): string {
  return label.replace(/[ \t\n\r]+/g, ' ').trim().toLowerCase()
}

/** The labels a block may refer to: anything in square brackets. */
export function referencedLabels(text: string): Set<string> {
  const out = new Set<string>()
  const re = /\[([^\[\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[1]) out.add(normalizeLabel(m[1]))
  }
  return out
}

/**
 * Splits a file into its original blocks with their normal forms. Each block
 * is parsed on its own, with the definitions it refers to appended, so
 * reference links resolve as they do in the whole file.
 */
export function splitOriginal(source: string, tools: Tools): OriginalBlock[] {
  const positioned = tools.blocks(source)
  const definitions = new Map<string, string>()
  for (const b of positioned) {
    if (b.definition && b.identifier) definitions.set(b.identifier, source.slice(b.position.start.offset, b.position.end.offset))
  }
  return positioned.map(({ position, definition }) => {
    // A block's bytes start at its line, indentation included, so an
    // indented list parses alone as it does in the file.
    let start = position.start.offset
    const lineStart = source.lastIndexOf('\n', start - 1) + 1
    if (lineStart < start && /^[ \t]*$/.test(source.slice(lineStart, start))) start = lineStart
    const bytes = source.slice(start, position.end.offset)
    if (definition) return { start, end: position.end.offset, bytes, norm: null }
    let withDefinitions = bytes
    if (definitions.size > 0 && bytes.includes('[')) {
      const needed: string[] = []
      for (const label of referencedLabels(bytes)) {
        const d = definitions.get(label)
        if (d !== undefined) needed.push(d)
      }
      if (needed.length > 0) withDefinitions = bytes + '\n\n' + needed.join('\n')
    }
    const norms = tools.norms(withDefinitions)
    const norm = norms.length === 0 ? null : norms.join('\n\n')
    return { start, end: position.end.offset, bytes, norm }
  })
}

export interface CurrentBlock {
  norm: string
}

/**
 * Assembles the saved text: each current block whose normal form equals an
 * unused original's takes that original's bytes, nearest first; the others
 * are written out from their normal form. Separators between consecutive
 * originals are kept; originals without an editor block stay in place.
 */
export function assemble(source: string, originals: OriginalBlock[], current: CurrentBlock[]): string {
  const byNorm = new Map<string, number[]>()
  originals.forEach((o, i) => {
    if (o.norm === null) return
    const list = byNorm.get(o.norm) ?? []
    list.push(i)
    byNorm.set(o.norm, list)
  })
  const used = new Set<number>()
  let cursor = -1
  const chosen: (number | null)[] = current.map((c) => {
    const candidates = (byNorm.get(c.norm) ?? []).filter((i) => !used.has(i))
    if (candidates.length === 0) return null
    const pick = candidates.find((i) => i > cursor) ?? candidates[0]
    used.add(pick)
    cursor = pick
    return pick
  })

  const leading = originals.length > 0 ? source.slice(0, originals[0].start) : ''
  const trailing = originals.length > 0 ? source.slice(originals[originals.length - 1].end) : source
  const separator = (a: number, b: number) => source.slice(originals[a].end, originals[b].start)

  // Invisible originals (definitions and the like) go right after the
  // original before them when it is kept, else right before the next kept
  // one, else at the end.
  const invisibleAfter = new Map<number, number[]>()
  const invisibleBefore = new Map<number, number[]>()
  const invisibleOrphans: number[] = []
  originals.forEach((o, i) => {
    if (o.norm !== null) return
    let prev = i - 1
    while (prev >= 0 && originals[prev].norm === null) prev--
    if (prev >= 0 && used.has(prev)) {
      invisibleAfter.set(prev, [...(invisibleAfter.get(prev) ?? []), i])
      return
    }
    let next = i + 1
    while (next < originals.length && originals[next].norm === null) next++
    if (next < originals.length && used.has(next)) {
      invisibleBefore.set(next, [...(invisibleBefore.get(next) ?? []), i])
      return
    }
    invisibleOrphans.push(i)
  })

  const parts: string[] = []
  let lastOriginal: number | null = null
  let first = true
  const push = (text: string, origin: number | null) => {
    if (!first) {
      const consecutive = lastOriginal !== null && origin !== null && origin > lastOriginal && originals.slice(lastOriginal + 1, origin).every((o, k) => used.has(lastOriginal! + 1 + k) || o.norm === null)
      if (consecutive && origin !== null && lastOriginal !== null) {
        parts.push(separator(lastOriginal, origin))
      } else {
        parts.push(parts.length > 0 && parts[parts.length - 1].endsWith('\n\n') ? '' : '\n\n')
      }
    }
    parts.push(text)
    first = false
    lastOriginal = origin
  }

  current.forEach((c, k) => {
    const origin = chosen[k]
    if (origin === null) {
      push(c.norm, null)
      return
    }
    for (const inv of invisibleBefore.get(origin) ?? []) {
      push(originals[inv].bytes, inv)
    }
    push(originals[origin].bytes, origin)
    for (const inv of invisibleAfter.get(origin) ?? []) {
      parts.push(separator(lastOriginal ?? origin, inv) || '\n\n')
      parts.push(originals[inv].bytes)
      lastOriginal = inv
    }
  })
  for (const inv of invisibleOrphans) {
    push(originals[inv].bytes, null)
  }
  let out = parts.join('')
  if (originals.length === 0) return current.length === 0 ? source : out + '\n'
  out = leading + out
  if (current.length === 0 && invisibleOrphans.length === 0) return leading.trimEnd() === '' ? '' : leading
  return out + trailing
}
