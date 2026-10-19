import { describe, expect, it } from 'vitest'
import { matchSegment, rank, scoreItem, segmentWords } from '../src/match'

const items = [
  { path: '/code/margin/plan.md', name: 'plan.md', dir: 'margin' },
  { path: '/code/margin/docs/guarded-commands-plan.md', name: 'guarded-commands-plan.md', dir: 'margin/docs' },
  { path: '/code/plans/other.md', name: 'other.md', dir: 'plans' },
  { path: '/code/notes/daily/2026-10-15.md', name: '2026-10-15.md', dir: 'notes/daily' },
]

const typed = [
  { path: '/code/margin/CLAUDE.md', name: 'margin', dir: '', type: { name: 'claude' } },
  { path: '/code/margin/.claude/skills/commit/SKILL.md', name: 'commit', dir: 'margin', type: { name: 'skill' } },
  { path: '/code/margin/docs/commit-flow.md', name: 'commit-flow.md', dir: 'margin/docs' },
  { path: '/code/margin/AGENTS.md', name: 'margin', dir: '', type: { name: 'rules' } },
]

describe('match', () => {
  it('F-07, S-10: a typed file matches on its shown name, its type name as a name, and its real file name', () => {
    expect(rank('claude margin', typed).map((m) => m.item.path)).toEqual(['/code/margin/CLAUDE.md'])
    expect(rank('skill commit', typed).map((m) => m.item.path)).toEqual(['/code/margin/.claude/skills/commit/SKILL.md'])
    expect(rank('agents', typed).map((m) => m.item.path)).toEqual(['/code/margin/AGENTS.md'])
    expect(rank('commit', typed).map((m) => m.item.path).sort()).toEqual(['/code/margin/.claude/skills/commit/SKILL.md', '/code/margin/docs/commit-flow.md'])
    expect(scoreItem(['claude'], typed[0])).toBeGreaterThan(scoreItem(['claude'], typed[1]))
  })

  it('S-10: a segment splits into words on dashes, underscores, dots and spaces', () => {
    expect(segmentWords('guarded-commands-plan')).toEqual(['guarded', 'commands', 'plan'])
    expect(segmentWords('my_notes.v2 draft')).toEqual(['my', 'notes', 'v2', 'draft'])
  })

  it('S-10: a word matches a segment as a substring or as an abbreviation of its words', () => {
    expect(matchSegment('plan', 'guarded-commands-plan')).toBeGreaterThan(0)
    expect(matchSegment('mand', 'guarded-commands-plan')).toBeGreaterThan(0)
    expect(matchSegment('gcp', 'guarded-commands-plan')).toBeGreaterThan(0)
    expect(matchSegment('cp', 'guarded-commands-plan')).toBeGreaterThan(0)
    expect(matchSegment('gp', 'guarded-commands-plan')).toBe(0)
    expect(matchSegment('xyz', 'guarded-commands-plan')).toBe(0)
  })

  it('S-10: words shorter than three letters only match at a word start', () => {
    expect(matchSegment('pl', 'plan')).toBeGreaterThan(0)
    expect(matchSegment('an', 'plan')).toBe(0)
    expect(matchSegment('co', 'guarded-commands-plan')).toBeGreaterThan(0)
    expect(matchSegment('om', 'guarded-commands-plan')).toBe(0)
    expect(matchSegment('lan', 'plan')).toBeGreaterThan(0)
  })

  it('S-10: every query word must match within one path segment', () => {
    expect(scoreItem(['margin', 'plan'], items[0])).toBeGreaterThan(0)
    expect(scoreItem(['marginplan'], items[0])).toBe(0)
    expect(scoreItem(['margin', 'nope'], items[0])).toBe(0)
    expect(scoreItem(['daily', '2026'], items[3])).toBeGreaterThan(0)
  })

  it('S-10: matches in the file name rank above matches in folders, case ignored', () => {
    const ranked = rank('PLAN', items).map((m) => m.item.path)
    expect(ranked.slice(0, 2)).toEqual(['/code/margin/plan.md', '/code/margin/docs/guarded-commands-plan.md'])
    expect(ranked[2]).toBe('/code/plans/other.md')
    expect(ranked).not.toContain('/code/notes/daily/2026-10-15.md')
  })

  it('S-09: an empty query keeps every item in its order', () => {
    expect(rank('', items).map((m) => m.item)).toEqual(items)
    expect(rank('   ', items)).toHaveLength(4)
  })
})
