// YAML frontmatter is kept out of the editor, which doesn't understand it,
// and reattached byte for byte on save.

export interface Split {
  frontmatter: string // including the --- lines, or '' when there is none
  body: string
}

const pattern = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/

export function splitFrontmatter(markdown: string): Split {
  const match = markdown.match(pattern)
  if (!match) return { frontmatter: '', body: markdown }
  return { frontmatter: match[0], body: markdown.slice(match[0].length) }
}

export function joinFrontmatter({ frontmatter, body }: Split): string {
  return frontmatter + body
}
