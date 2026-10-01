// Matching for the file finder. Every word of the query must match within a
// single path segment, either as a substring or as an abbreviation of its
// words, so a query never matches by scattering its letters across a path.
// Higher scores are better; null means no match.
export function fuzzyScore(query: string, path: string): number | null {
  const terms = query.toLowerCase().split(/[\s/]+/).filter(Boolean)
  if (terms.length === 0) return 0
  const text = path.toLowerCase()
  const segments = text.split('/')
  const last = segments.length - 1

  let total = 0
  for (const term of terms) {
    let best: number | null = null
    segments.forEach((segment, i) => {
      const score = segmentScore(term, segment)
      if (score !== null) best = Math.max(best ?? -Infinity, score + (i === last ? 10 : 0))
    })
    if (best === null) return null
    total += best
  }
  return total - text.length * 0.01
}

const isWordStart = (text: string, at: number) => at === 0 || '-_. '.includes(text[at - 1])

// Where term occurs in segment, or -1. Terms shorter than three letters
// match too much mid-word, so they only match at the start of a word.
function substringAt(term: string, segment: string): number {
  for (let at = segment.indexOf(term); at >= 0; at = segment.indexOf(term, at + 1)) {
    if (term.length >= 3 || isWordStart(segment, at)) return at
  }
  return -1
}

function segmentScore(term: string, segment: string): number | null {
  const at = substringAt(term, segment)
  if (at >= 0) return 20 + term.length * 2 + (isWordStart(segment, at) ? 5 : 0)

  // Letters in order, each continuing the previous one or starting a word,
  // like `gcp` for guarded-commands-plan.
  let score = 0
  let pos = -1
  for (const char of term) {
    if (pos >= 0 && segment[pos + 1] === char) {
      pos++
      score += 3
      continue
    }
    let found = -1
    for (let i = pos + 1; i < segment.length && found === -1; i++) {
      if (segment[i] === char && isWordStart(segment, i)) found = i
    }
    if (found === -1) return null
    pos = found
    score += 2
  }
  return score
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string, limit: number): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item)
}
