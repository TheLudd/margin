// The table of contents (D-10): built from h1–h4, never part of the
// document, following the heading in view.

export interface TocEntry {
  id: string
  level: number
  text: string
  /** The heading's top within the scroller's content. */
  top: number
}

/**
 * The entry in view: the last heading at or above the scroll position (with
 * the sticky header's height as offset), or the last heading of all when the
 * scroller is at the bottom. -1 without headings.
 */
export function activeEntry(entries: TocEntry[], scrollTop: number, clientHeight: number, scrollHeight: number, offset = 61): number {
  if (entries.length === 0) return -1
  if (scrollTop + clientHeight >= scrollHeight - 2) return entries.length - 1
  let active = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].top <= scrollTop + offset) active = i
    else break
  }
  return active
}

/** A slug for a heading's text, used as its anchor when it has no id. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Reads the headings h1–h4 out of a rendered document. */
export function readEntries(article: HTMLElement, scroller: HTMLElement): TocEntry[] {
  const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4'))
  const used = new Set<string>()
  const scrollerTop = scroller.getBoundingClientRect().top
  return headings.map((h) => {
    let id = h.id || slug(h.textContent ?? '')
    if (!id) id = 'heading'
    let unique = id
    let n = 2
    while (used.has(unique)) unique = `${id}-${n++}`
    used.add(unique)
    if (h.id !== unique) h.id = unique
    const top = h.getBoundingClientRect().top - scrollerTop + scroller.scrollTop
    return { id: unique, level: Number(h.tagName[1]), text: h.textContent ?? '', top }
  })
}

export function renderToc(container: HTMLElement, entries: TocEntry[], active: number): void {
  container.replaceChildren()
  entries.forEach((e, i) => {
    const a = document.createElement('a')
    a.href = '#' + e.id
    a.className = `level-${e.level}` + (i === active ? ' active' : '')
    a.textContent = e.text
    a.dataset.id = e.id
    container.append(a)
  })
}

/** Marks the active link and keeps it in view in the panel. */
export function markActive(container: HTMLElement, active: number): void {
  const links = container.querySelectorAll('a')
  links.forEach((a, i) => a.classList.toggle('active', i === active))
  const link = links[active]
  if (link && typeof link.scrollIntoView === 'function') link.scrollIntoView({ block: 'nearest' })
}
