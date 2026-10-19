// Finder matching (S-10): every query word must match within one path
// segment, as a substring or as an abbreviation of its words; words shorter
// than three letters only match at a word start. Matches in the file name
// rank above matches in folders. A typed file (F-07) also matches on its
// type's name, ranked as the name, and on its real file name.

export interface Candidate {
  path: string
  name: string
  dir: string
  type?: { name: string }
}

export interface Match<T extends Candidate> {
  item: T
  score: number
}

/** The words of a segment: split on dashes, underscores, dots and spaces. */
export function segmentWords(segment: string): string[] {
  return segment
    .toLowerCase()
    .split(/[-_.\s]+/)
    .filter(Boolean)
}

/**
 * How well a query word matches a segment: 0 for no match, higher is
 * better. A prefix of a word scores 3, a substring 2, an abbreviation 2.
 */
export function matchSegment(word: string, segment: string): number {
  const w = word.toLowerCase()
  const seg = segment.toLowerCase()
  const words = segmentWords(segment)
  if (w.length === 0) return 0
  if (words.some((s) => s.startsWith(w))) return 3
  if (w.length >= 3 && seg.includes(w)) return 2
  if (w.length >= 2 && abbreviates(w, words)) return 2
  return 0
}

/** Whether w is the initials of a run of consecutive words. */
function abbreviates(w: string, words: string[]): boolean {
  const initials = words.map((s) => s[0]).join('')
  return initials.includes(w)
}

/** Scores one item against the query words; 0 when any word fails. */
export function scoreItem(words: string[], item: Candidate): number {
  const names = [item.name.replace(/\.md$/i, '')]
  const others = item.dir ? item.dir.split('/') : []
  if (item.type) {
    names.push(item.type.name)
    others.push(item.path.split('/').pop()?.replace(/\.md$/i, '') ?? '')
  }
  let total = 0
  for (const word of words) {
    let inName = 0
    for (const n of names) inName = Math.max(inName, matchSegment(word, n))
    if (inName > 0) {
      total += 10 + inName
      continue
    }
    let best = 0
    for (const d of others) best = Math.max(best, matchSegment(word, d))
    if (best === 0) return 0
    total += best
  }
  // Shorter paths first among equals.
  return total * 1000 - Math.min(999, item.path.length)
}

/** Ranks the items matching every word of the query, best first. */
export function rank<T extends Candidate>(query: string, items: T[]): Match<T>[] {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items.map((item) => ({ item, score: 0 }))
  const out: Match<T>[] = []
  for (const item of items) {
    const score = scoreItem(words, item)
    if (score > 0) out.push({ item, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
