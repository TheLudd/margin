import { describe, expect, it } from 'vitest'
import { buildHeader, setCommit, setCopies, setEditing, setHeaderLabel, setManual, setStatus } from '../src/header'

describe('header', () => {
  it('F-04, D-14: the header shows the file label, name first', () => {
    const h = buildHeader()
    setHeaderLabel(h, 'plan.md', 'margin')
    expect(h.path.querySelector('.file-label .name')?.textContent).toBe('plan.md')
    expect(h.path.querySelector('.file-label .dir')?.textContent).toBe('margin')
  })

  it('F-07: the header label carries the type mark', () => {
    const h = buildHeader()
    setHeaderLabel(h, 'Margin', '', { type: { name: 'claude', mark: 'claude', color: 'cyan' }, path: '/code/margin/CLAUDE.md' })
    expect(h.path.querySelector('.file-label .mark')?.textContent).toBe('claude')
    expect(h.path.querySelector('.file-label .name')?.textContent).toBe('Margin')
  })

  it('W-04: every copy is listed as main, unchanged or changed when, the open one selected', () => {
    const h = buildHeader()
    const now = 1_000_000
    setCopies(h, [], '/x', now)
    expect(h.worktree.hidden).toBe(true)
    setCopies(
      h,
      [
        { path: '/code/foo/main/a.md', label: 'main', state: 'main' },
        { path: '/code/foo/feat/a.md', label: 'feat', state: 'changed', time: now - 7200 },
        { path: '/code/foo/other/a.md', label: 'other', state: 'unchanged' },
      ],
      '/code/foo/feat/a.md',
      now,
    )
    expect(h.worktree.hidden).toBe(false)
    const options = Array.from(h.worktree.options).map((o) => [o.value, o.textContent, o.selected])
    expect(options).toEqual([
      ['/code/foo/main/a.md', 'main · main', false],
      ['/code/foo/feat/a.md', 'feat · changed 2 hours ago', true],
      ['/code/foo/other/a.md', 'other · unchanged', false],
    ])
  })

  it('J-01, D-02, CH-11, CH-13: badges carry their state and keep their text widths', () => {
    const h = buildHeader()
    setEditing(h, true)
    expect(h.badges.edit.textContent).toBe('editing')
    expect(h.badges.edit.classList.contains('active')).toBe(true)
    setEditing(h, false)
    expect(h.badges.edit.textContent).toBe('edit')
    setManual(h, true)
    expect(h.badges.manual.dataset.state).toBe('on')
    setCommit(h, '')
    expect(h.badges.commit.hidden).toBe(true)
    setCommit(h, 'uncommitted')
    expect(h.badges.commit.hidden).toBe(false)
    expect(h.badges.commit.textContent).toBe('uncommitted')
    expect(h.badges.commit.classList.contains('unstable')).toBe(true)
    expect(h.badges.commit.disabled).toBe(false)
    setCommit(h, 'committed')
    expect(h.badges.commit.classList.contains('unstable')).toBe(false)
    expect(h.badges.commit.disabled).toBe(true)
    setCommit(h, 'untracked')
    expect(h.badges.commit.classList.contains('untracked')).toBe(true)
    for (const [status, text, state] of [
      ['saved', 'saved', 'clean'],
      ['unsaved', 'unsaved', 'dirty'],
      ['saving', 'saving', 'saving'],
      ['conflict', 'conflict', 'conflict'],
      ['deleted', 'deleted', 'missing'],
      ['retrying', 'retrying', 'error'],
    ] as const) {
      setStatus(h, status)
      expect(h.badges.status.textContent).toBe(text)
      expect(h.badges.status.dataset.state).toBe(state)
      expect(h.badges.status.classList.contains('unstable')).toBe(status !== 'saved')
    }
  })

  it('L-19, CH-06, CH-07, CH-12: the changes controls exist, hidden until there are changes', () => {
    const h = buildHeader()
    expect(h.changes.hidden).toBe(true)
    expect(h.count.className).toBe('count')
    expect(h.prev.textContent).toBe('↑')
    expect(h.next.textContent).toBe('↓')
    expect(h.markRead.textContent).toBe('mark read')
  })
})
