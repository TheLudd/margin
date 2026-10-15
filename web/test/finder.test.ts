import { describe, expect, it } from 'vitest'
import { buildFinder, finderView, renderFinder } from '../src/finder'
import type { Entry, Lists } from '../src/types'

const now = 1_000_000

function entry(path: string, over: Partial<Entry> = {}): Entry {
  const parts = path.split('/')
  return { path, name: parts[parts.length - 1], dir: parts.slice(2, -1).join('/'), unread: false, ...over }
}

function lists(): Lists {
  const recent = Array.from({ length: 12 }, (_, i) => entry(`/code/recent/r${i}.md`, { time: now - i * 60, kind: 'view' }))
  recent[0] = entry('/code/margin/plan.md', { time: now - 10, kind: 'view', copies: 2 })
  const older = Array.from({ length: 15 }, (_, i) => entry(`/code/old/o${i}.md`))
  older[0] = entry('/code/old/plan-b.md')
  return { roots: [{ name: 'code', path: '/x' }], activeDays: 14, recent, older: [{ project: 'old', files: older }] }
}

describe('finder', () => {
  it('S-09: an empty query lists recent activity, the best 10, and says n of m', () => {
    const v = finderView(lists(), { query: '', older: false, selected: 0 })
    expect(v.recent).toHaveLength(10)
    expect(v.recentTotal).toBe(12)
    expect(v.recent[0].entry.path).toBe('/code/margin/plan.md')
    expect(v.olderRows).toHaveLength(0)
    expect(v.olderTotal).toBe(15)
    const refs = buildFinder(document.createElement('div'))
    renderFinder(refs, v, { query: '', older: false, selected: 0 }, now)
    expect(refs.list.querySelector('li.tier')?.textContent).toBe('Recent · 10 of 12')
    expect(refs.list.querySelectorAll('li.row')).toHaveLength(10)
    expect(refs.list.querySelector('li.toggle')?.textContent).toBe('Tab · 15 older files')
  })

  it('S-09: a query searches active files only until Tab adds an Older section', () => {
    const l = lists()
    let v = finderView(l, { query: 'plan', older: false, selected: 0 })
    expect(v.recent.map((r) => r.entry.path)).toEqual(['/code/margin/plan.md'])
    expect(v.olderRows).toHaveLength(0)
    expect(v.olderTotal).toBe(1)
    v = finderView(l, { query: 'plan', older: true, selected: 0 })
    expect(v.olderRows.map((r) => r.entry.path)).toEqual(['/code/old/plan-b.md'])
    expect(v.rows).toHaveLength(2)
    const refs = buildFinder(document.createElement('div'))
    renderFinder(refs, v, { query: 'plan', older: true, selected: 1 }, now)
    const tiers = refs.list.querySelectorAll('li.tier')
    expect(tiers[1].textContent).toBe('Older')
    expect(tiers[1].classList.contains('older')).toBe(true)
    expect(refs.list.querySelector('li.selected')?.classList.contains('older')).toBe(true)
    expect(refs.list.querySelector('li.toggle')?.textContent).toBe('Tab · hide older files')
  })

  it('S-11, F-04, W-01, L-32: rows are links with the file label, a copy count and a time', () => {
    const refs = buildFinder(document.createElement('div'))
    const v = finderView(lists(), { query: '', older: false, selected: 0 })
    renderFinder(refs, v, { query: '', older: false, selected: 0 }, now)
    const first = refs.list.querySelector('li.row')!
    const a = first.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/code/margin/plan.md')
    expect(a.querySelector('.file-label .name')?.textContent).toBe('plan.md')
    expect(a.querySelector('.file-label .dir')?.textContent).toBe('margin')
    expect(a.querySelector('.copies')?.textContent).toBe('×2')
    expect(a.querySelector('time')?.textContent).toBe('now')
    expect(first.classList.contains('selected')).toBe(true)
  })

  it('S-09: with nothing matching the sections say so', () => {
    const refs = buildFinder(document.createElement('div'))
    const state = { query: 'zzzz', older: true, selected: 0 }
    renderFinder(refs, finderView(lists(), state), state, now)
    const none = refs.list.querySelectorAll('li.none')
    expect(none[0].textContent).toBe('No recent file matches')
    expect(none[1].textContent).toBe('No older file matches')
  })
})
