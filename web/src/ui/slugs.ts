// Anchors for headings as GitHub makes them, so links written for GitHub
// land on the same heading: lower case, punctuation dropped, spaces as
// dashes, and repeats numbered.
export function slugs(headings: string[]): string[] {
  const seen = new Map<string, number>()
  return headings.map((text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/\s/g, '-')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  })
}
