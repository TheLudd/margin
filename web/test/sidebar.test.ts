import { describe, expect, it } from 'vitest'
import { buildSidebar, renderSidebar, type FoldStore } from '../src/sidebar'
import type { Lists } from '../src/types'

function memoryFolds(): FoldStore & { data: Record<string, boolean> } {
  const data: Record<string, boolean> = {}
  return {
    data,
    get: (k) => (k in data ? data[k] : null),
    set: (k, v) => {
      data[k] = v
    },
  }
}

const now = 1_000_000

function lists(over: Partial<Lists> = {}): Lists {
  return {
    roots: [{ name: 'code', path: '/home/u/code' }],
    activeDays: 14,
    recent: [
      { path: '/code/a.md', name: 'a.md', dir: '', time: now - 60, kind: 'view', unread: false },
      { path: '/code/foo/b.md', name: 'b.md', dir: 'foo', time: now - 7200, kind: 'modified', unread: true },
      { path: '/code/foo/main/c.md', name: 'c.md', dir: 'foo', time: now - 86400, kind: 'view', unread: true, copies: 2, copiesChanged: true },
    ],
    older: [
      {
        project: 'foo',
        files: [
          { path: '/code/foo/main/d.md', name: 'd.md', dir: 'foo', unread: false, copies: 2 },
          { path: '/code/foo/e.md', name: 'e.md', dir: 'foo', unread: true },
        ],
      },
      { project: 'zed', files: [{ path: '/code/zed/f.md', name: 'f.md', dir: 'zed', unread: false }] },
    ],
    ...over,
  }
}

function render(l: Lists, current: string | null = null, folds = memoryFolds()) {
  const root = document.createElement('aside')
  const refs = buildSidebar(root, folds)
  renderSidebar(refs, { lists: l, current, now }, folds)
  return { root, refs, folds }
}

describe('sidebar', () => {
  it('S-01, S-04, L-11: Recent and Older are foldable sections with counts', () => {
    const { refs } = render(lists())
    expect(refs.recent.querySelector('summary h2')?.textContent).toBe('Recent')
    expect(refs.recentCount.textContent).toBe('3')
    expect(refs.olderCount.textContent).toBe('3')
    expect(refs.recent.open).toBe(true)
    expect(refs.older.open).toBe(true)
  })

  it('F-07: a typed entry draws the mark before the name in both sections', () => {
    const typed = { type: { name: 'claude', mark: 'claude' } }
    const { root } = render(
      lists({
        recent: [{ path: '/code/zed/CLAUDE.md', name: 'zed', dir: '', time: now - 60, kind: 'view', unread: false, ...typed }],
        older: [{ project: 'foo', files: [{ path: '/code/foo/CLAUDE.md', name: 'foo', dir: '', unread: false, ...typed }] }],
      }),
    )
    for (const href of ['/code/zed/CLAUDE.md', '/code/foo/CLAUDE.md']) {
      const label = root.querySelector(`a[href="${href}"] .file-label`) as HTMLElement
      expect(label.firstElementChild?.className).toBe('mark')
      expect(label.firstElementChild?.textContent).toBe('claude')
      expect(label.querySelector('.name')?.textContent).toBe(href.split('/')[2])
      expect(label.title).toBe('claude · ' + href.slice(1))
    }
  })

  it('S-11, F-04, L-12: entries are real links with the name, the folder, and a time or copy count', () => {
    const { root } = render(lists())
    const links = root.querySelectorAll('details[data-section=recent] a')
    expect(links).toHaveLength(3)
    expect(links[0].getAttribute('href')).toBe('/code/a.md')
    expect(links[0].querySelector('.file-label .name')?.textContent).toBe('a.md')
    expect(links[0].querySelector('.file-label .dir')).toBeNull()
    expect(links[0].querySelector('time')?.textContent).toBe('1m')
    expect(links[0].querySelector('time')?.classList.contains('modified')).toBe(false)
    expect(links[1].querySelector('.file-label .dir')?.textContent).toBe('foo')
    expect(links[1].querySelector('time')?.textContent).toBe('2h')
    expect(links[1].querySelector('time')?.classList.contains('modified')).toBe(true)
    expect(links[2].querySelector('.copies')?.textContent).toBe('×2')
    expect(links[2].querySelector('.copies')?.classList.contains('changed')).toBe(true)
  })

  it('S-07: unread entries carry the unread class', () => {
    const { root } = render(lists())
    const unread = Array.from(root.querySelectorAll('a.unread')).map((a) => a.getAttribute('href'))
    expect(unread).toEqual(['/code/foo/b.md', '/code/foo/main/c.md', '/code/foo/e.md'])
  })

  it('S-05: every Recent entry has a forget button carrying its path', () => {
    const { root } = render(lists())
    const buttons = root.querySelectorAll('details[data-section=recent] button.forget')
    expect(buttons).toHaveLength(3)
    expect((buttons[1] as HTMLElement).dataset.path).toBe('/code/foo/b.md')
    expect(root.querySelectorAll('details[data-section=older] button.forget')).toHaveLength(0)
  })

  it('S-04, W-01: Older groups by project with counts, sorted by name within, groups folded by default', () => {
    const { root } = render(lists())
    const groups = root.querySelectorAll('details.project')
    expect(groups).toHaveLength(2)
    expect(groups[0].getAttribute('data-project')).toBe('foo')
    expect(groups[0].querySelector('summary .count')?.textContent).toBe('2')
    expect((groups[0] as HTMLDetailsElement).open).toBe(false)
    const names = Array.from(groups[0].querySelectorAll('a .name')).map((n) => n.textContent)
    expect(names).toEqual(['d.md', 'e.md'])
    expect(groups[0].querySelectorAll('a')[0].querySelector('.copies')?.textContent).toBe('×2')
  })

  it('S-04: fold state is read from and written to the store', () => {
    const folds = memoryFolds()
    folds.data['older'] = false
    folds.data['project:zed'] = true
    const { refs, root } = render(lists(), null, folds)
    expect(refs.older.open).toBe(false)
    expect((root.querySelector('details[data-project=zed]') as HTMLDetailsElement).open).toBe(true)
    refs.recent.open = false
    refs.recent.dispatchEvent(new Event('toggle'))
    expect(folds.data['recent']).toBe(false)
  })

  it('S-04: a click on a summary writes the coming fold state at once, before the toggle event', () => {
    const folds = memoryFolds()
    const { refs, root } = render(lists(), null, folds)
    refs.older.querySelector(':scope > summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(folds.data['older']).toBe(false)
    const group = root.querySelector('details[data-project=foo]') as HTMLDetailsElement
    group.querySelector(':scope > summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(folds.data['project:foo']).toBe(true)
  })

  it('L-12: the open file is marked current', () => {
    const { root } = render(lists(), '/code/foo/b.md')
    expect(root.querySelector('a.current')?.getAttribute('href')).toBe('/code/foo/b.md')
    expect(root.querySelectorAll('a.current')).toHaveLength(1)
  })

  it('L-14: empty sections say so', () => {
    const { root } = render(lists({ recent: [], older: [] }))
    const empties = root.querySelectorAll('.empty')
    expect(empties[0].textContent).toBe('Nothing in the last 14 days')
    expect(empties[1].textContent).toBe('Nothing yet')
  })

  it('L-09, L-10, L-15, C-08: the brand, the fold buttons, the search field with its kbd and the settings row are there', () => {
    const { refs, root } = render(lists())
    expect(root.querySelector('.brand')?.textContent).toBe('margin')
    expect(refs.closeButton.textContent).toBe('×')
    expect(refs.findButton.querySelector('kbd')?.textContent).toBe('Ctrl K')
    expect(refs.findButton.textContent).toContain('Open file…')
    expect(refs.settingsRow.getAttribute('href')).toBe('/settings')
  })
})
