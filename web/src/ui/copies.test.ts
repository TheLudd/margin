import { beforeEach, describe, expect, it } from 'vitest'
import type { FileEntry } from '../api'
import { groupCopies, isActive, type LogicalFile } from './copies'

const entry = (repo: string, rel: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: `${repo}/${rel}`,
  repo,
  project: repo.startsWith('gaius/') ? 'gaius' : repo,
  main: repo !== 'gaius/claims' && repo !== 'gaius/views',
  ...extra,
})

let groups: LogicalFile[]
const group = (rel: string) => groups.find((g) => g.rel === rel)!

describe('groupCopies when no worktree changed a file', () => {
  beforeEach(() => {
    groups = groupCopies([entry('gaius/claims', 'CLAUDE.md'), entry('gaius/master', 'CLAUDE.md'), entry('gaius/views', 'CLAUDE.md')])
  })

  it('shows it once', () => expect(groups).toHaveLength(1))

  it('keeps every copy, main first', () =>
    expect(group('CLAUDE.md').copies.map((c) => c.repo)).toEqual(['gaius/master', 'gaius/claims', 'gaius/views']))

  it('prefers the main checkout', () => expect(group('CLAUDE.md').preferred.repo).toBe('gaius/master'))

  it('is not marked changed', () => expect(group('CLAUDE.md').changed).toBe(false))
})

describe('groupCopies when worktrees changed a file', () => {
  beforeEach(() => {
    groups = groupCopies([
      entry('gaius/master', 'plan.md'),
      entry('gaius/claims', 'plan.md', { changed: '2026-09-20T10:00:00Z' }),
      entry('gaius/views', 'plan.md', { changed: '2026-09-28T10:00:00Z' }),
    ])
  })

  it('prefers the most recently changed copy', () => expect(group('plan.md').preferred.repo).toBe('gaius/views'))

  it('is marked changed', () => expect(group('plan.md').changed).toBe(true))
})

describe('groupCopies when only the main checkout has uncommitted changes', () => {
  beforeEach(() => {
    groups = groupCopies([entry('gaius/master', 'plan.md', { changed: '2026-09-28T10:00:00Z' }), entry('gaius/claims', 'plan.md')])
  })

  it('prefers the main checkout', () => expect(group('plan.md').preferred.repo).toBe('gaius/master'))

  it('is not marked as differing between worktrees', () => expect(group('plan.md').changed).toBe(false))
})

describe('groupCopies with separate repositories', () => {
  beforeEach(() => {
    groups = groupCopies([entry('a4', 'README.md'), entry('amend', 'README.md')])
  })

  it('keeps them apart', () => expect(groups).toHaveLength(2))
})

describe('isActive', () => {
  const now = Date.parse('2026-10-01T12:00:00Z')
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString()
  const active = (...copies: FileEntry[]) => isActive(groupCopies(copies)[0], 14, now)

  it('counts a recent modification', () => expect(active(entry('a4', 'x.md', { modified: daysAgo(3) }))).toBe(true))

  it('counts a recent view', () => expect(active(entry('a4', 'x.md', { viewed: daysAgo(13) }))).toBe(true))

  it('ignores activity older than 14 days', () => expect(active(entry('a4', 'x.md', { modified: daysAgo(15), viewed: daysAgo(20) }))).toBe(false))

  it('ignores a file nobody modified or viewed', () => expect(active(entry('gaius/master', 'x.md'), entry('gaius/claims', 'x.md'))).toBe(false))

  it('uses the given window', () => expect(isActive(groupCopies([entry('a4', 'x.md', { modified: daysAgo(20) })])[0], 30, now)).toBe(true))

  it('counts a change made in a worktree', () =>
    expect(active(entry('gaius/master', 'x.md'), entry('gaius/claims', 'x.md', { modified: daysAgo(2) }))).toBe(true))
})
