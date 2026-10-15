// Frontmatter (D-06): split off before parsing, reattached byte for byte.

export interface Split {
  /** The frontmatter block as in the file, fences and trailing newline included, or ''. */
  raw: string
  /** The text between the fences. */
  text: string
  /** The rest of the file. */
  body: string
}

const FENCE = /^(---[ \t]*\r?\n)([\s\S]*?\r?\n)?(---[ \t]*)(\r?\n|$)/

export function splitFrontmatter(source: string): Split {
  const m = FENCE.exec(source)
  if (!m) return { raw: '', text: '', body: source }
  const raw = m[0]
  const inner = m[2] ?? ''
  const text = inner.replace(/\r?\n$/, '')
  return { raw, text, body: source.slice(raw.length) }
}

/** Puts the frontmatter back: untouched text keeps the original bytes. */
export function joinFrontmatter(split: Split, text: string, body: string): string {
  if (!split.raw && text === '') return body
  if (text === split.text && split.raw) return split.raw + body
  const nl = split.raw.includes('\r\n') ? '\r\n' : '\n'
  return `---${nl}${text}${nl}---${nl}${body}`
}
