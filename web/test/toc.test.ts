import { describe, expect, it } from 'vitest'
import { activeEntry, markActive, readEntries, renderToc, slug, type TocEntry } from '../src/toc'

const entries: TocEntry[] = [
  { id: 'a', level: 1, text: 'A', top: 0 },
  { id: 'b', level: 2, text: 'B', top: 400 },
  { id: 'c', level: 3, text: 'C', top: 800 },
]

describe('toc', () => {
  it('D-10: the heading in view is the last one at or above the scroll position, the last of all at the bottom', () => {
    expect(activeEntry(entries, 0, 600, 2000)).toBe(0)
    expect(activeEntry(entries, 350, 600, 2000)).toBe(1)
    expect(activeEntry(entries, 738, 600, 2000)).toBe(1)
    expect(activeEntry(entries, 739, 600, 2000)).toBe(2)
    expect(activeEntry(entries, 1400, 600, 2000)).toBe(2)
    expect(activeEntry(entries, 300, 1700, 2000)).toBe(2)
    expect(activeEntry([], 0, 600, 2000)).toBe(-1)
  })

  it('D-10: anchors are slugs of the heading text', () => {
    expect(slug('Hello World!')).toBe('hello-world')
    expect(slug('  Ünïcode  héadings ')).toBe('ünïcode-héadings')
  })

  it('D-10: headings h1–h4 are read with unique ids, h5 and deeper left out', () => {
    const scroller = document.createElement('div')
    const article = document.createElement('div')
    article.innerHTML = '<h1 id="one">One</h1><p>x</p><h2>Two</h2><h5>Five</h5><h2>Two</h2><h4>Four</h4>'
    scroller.append(article)
    const got = readEntries(article, scroller)
    expect(got.map((e) => [e.level, e.id, e.text])).toEqual([
      [1, 'one', 'One'],
      [2, 'two', 'Two'],
      [2, 'two-2', 'Two'],
      [4, 'four', 'Four'],
    ])
    expect(article.querySelectorAll('h2')[1].id).toBe('two-2')
  })

  it('D-10, L-16: links are blocks with their level, the active one marked', () => {
    const container = document.createElement('div')
    renderToc(container, entries, 1)
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(3)
    expect(links[0].className).toBe('level-1')
    expect(links[1].className).toBe('level-2 active')
    expect(links[2].getAttribute('href')).toBe('#c')
    markActive(container, 2)
    expect(container.querySelectorAll('a.active')).toHaveLength(1)
    expect(links[2].classList.contains('active')).toBe(true)
  })
})
