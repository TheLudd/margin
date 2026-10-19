import { describe, expect, it } from 'vitest'
import { fileLabel, relativeTime, relativeWords, splitPath } from '../src/format'

describe('format', () => {
  it('L-12, S-06: relative times are short: now, minutes, hours, days, weeks', () => {
    const now = 1_000_000
    expect(relativeTime(now - 5, now)).toBe('now')
    expect(relativeTime(now - 90, now)).toBe('1m')
    expect(relativeTime(now - 3600 * 3, now)).toBe('3h')
    expect(relativeTime(now - 86400 * 2, now)).toBe('2d')
    expect(relativeTime(now - 86400 * 21, now)).toBe('3w')
    expect(relativeTime(now + 100, now)).toBe('now')
  })

  it('W-04: relative times in words for the copies select', () => {
    const now = 1_000_000
    expect(relativeWords(now - 5, now)).toBe('just now')
    expect(relativeWords(now - 3600, now)).toBe('1 hour ago')
    expect(relativeWords(now - 86400 * 3, now)).toBe('3 days ago')
  })

  it('F-04: a file label is the name first, then the folder in a muted span', () => {
    const label = fileLabel('plan.md', 'code/margin')
    expect(label.className).toBe('file-label')
    expect(label.children[0].className).toBe('name')
    expect(label.children[0].textContent).toBe('plan.md')
    expect(label.children[1].className).toBe('dir')
    expect(label.children[1].textContent).toBe('code/margin')
    expect(label.title).toBe('code/margin/plan.md')
    expect(fileLabel('top.md', '').children.length).toBe(1)
  })

  it('F-07: a typed file has its mark before the name, named for screen readers, and the type and address in the tooltip', () => {
    const label = fileLabel('Margin', '', { type: { name: 'claude', mark: 'claude', color: 'cyan' }, path: '/code/margin/CLAUDE.md' })
    expect(Array.from(label.children).map((c) => c.className)).toEqual(['mark', 'name'])
    expect(label.children[0].textContent).toBe('claude')
    expect(label.children[0].getAttribute('aria-label')).toBe('claude')
    expect(label.children[1].textContent).toBe('Margin')
    expect(label.title).toBe('claude · code/margin/CLAUDE.md')
    expect((label.children[0] as HTMLElement).dataset.color).toBe('cyan')
    const glyph = fileLabel('Commit', 'margin', { type: { name: 'skill', mark: '✦', color: 'amber' } })
    expect(glyph.children[0].textContent).toBe('✦')
    expect(glyph.children[0].className).toBe('mark glyph')
    expect((glyph.children[0] as HTMLElement).dataset.color).toBe('amber')
    expect(label.children[0].className).toBe('mark')
    expect(glyph.title).toBe('skill · margin/Commit')
  })

  it('F-03: a path splits into root, name and folder, the root left out of the folder with a single root', () => {
    expect(splitPath('/code/margin/plan.md', true)).toEqual({ root: 'code', name: 'plan.md', dir: 'margin' })
    expect(splitPath('/code/margin/plan.md', false)).toEqual({ root: 'code', name: 'plan.md', dir: 'code/margin' })
    expect(splitPath('/code/top.md', true)).toEqual({ root: 'code', name: 'top.md', dir: '' })
    expect(splitPath('/code/top.md', false)).toEqual({ root: 'code', name: 'top.md', dir: 'code' })
  })
})
