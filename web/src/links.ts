// Links in documents (D-13): a link to another markdown file resolves
// against the open file's folder and opens in margin.

/** Whether an href points at a markdown file margin could open. */
export function isMarkdownLink(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) return false
  const path = href.split('#')[0].split('?')[0]
  return /\.md$/i.test(path)
}

/** Resolves a relative markdown link against the open file's margin path. */
export function resolveMarkdownLink(href: string, docPath: string): string {
  const [pathPart, hash] = splitHash(href)
  let resolved: string
  if (pathPart.startsWith('/')) {
    resolved = pathPart
  } else {
    const base = docPath.split('/').slice(0, -1)
    for (const seg of pathPart.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') {
        if (base.length > 2) base.pop()
        continue
      }
      base.push(seg)
    }
    resolved = base.join('/')
  }
  try {
    resolved = decodeURIComponent(resolved)
  } catch {
    // Keep as is.
  }
  return resolved + (hash ? '#' + hash : '')
}

function splitHash(href: string): [string, string] {
  const i = href.indexOf('#')
  return i < 0 ? [href, ''] : [href.slice(0, i), href.slice(i + 1)]
}
