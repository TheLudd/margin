// Subsequence matching for the file finder. Higher scores are better;
// null means no match. Matches in the file name, at word starts and in
// runs score higher.
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (q === '') return 0
  const text = path.toLowerCase()
  const nameStart = text.lastIndexOf('/') + 1

  let score = 0
  let previous = -2
  let from = 0
  for (const char of q) {
    const at = text.indexOf(char, from)
    if (at === -1) return null
    if (at === previous + 1) score += 5
    if (at === 0 || '/-_. '.includes(text[at - 1])) score += 3
    if (at >= nameStart) score += 2
    previous = at
    from = at + 1
  }
  return score - text.length * 0.01
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string, limit: number): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item)
}
