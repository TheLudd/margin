import { describe, expect, it } from 'vitest'
import { countLabel, diffBlocks, diffTable, diffWords, groupChanges, lcs, nextChange, onScreen, prevChange, similarity, type Block } from '../src/changes'

function p(text: string, kind: Block['kind'] = 'paragraph'): Block {
  return { norm: text, kind, text }
}

describe('changes', () => {
  it('CH-05: equal blocks pair up; new blocks are added, missing ones removed', () => {
    const base = [p('a'), p('b'), p('c')]
    const cur = [p('a'), p('x'), p('c'), p('d')]
    const d = diffBlocks(base, cur)
    expect(d.blocks.map((b) => b.mark)).toEqual(['same', 'added', 'same', 'added'])
    expect(d.removed).toEqual([{ baseline: 1, before: 1 }])
  })

  it('CH-05: a block with enough shared words is modified, not removed and added', () => {
    const base = [p('The quick brown fox jumps over the lazy dog')]
    const cur = [p('The quick brown fox jumps over the sleepy dog')]
    const d = diffBlocks(base, cur)
    expect(d.blocks).toEqual([{ mark: 'modified', baseline: 0 }])
    expect(d.removed).toEqual([])
    expect(similarity('a b c', 'a b d')).toBeCloseTo(2 / 3)
    expect(similarity('', '')).toBe(1)
  })

  it('CH-05: a code block or table counts as one block, modified when its text changed', () => {
    const base = [p('const x = 1', 'code_block'), p('| a |', 'table')]
    const cur = [p('const x = 2', 'code_block'), p('| b |', 'table')]
    const d = diffBlocks(base, cur)
    expect(d.blocks.map((b) => b.mark)).toEqual(['modified', 'modified'])
  })

  it('CH-05: blocks of different kinds never pair as modified', () => {
    const d = diffBlocks([p('same words here', 'heading')], [p('same words here now', 'paragraph')])
    expect(d.blocks[0].mark).toBe('added')
    expect(d.removed).toEqual([{ baseline: 0, before: 0 }])
  })

  it('CH-06: changed or removed blocks separated by at most one unchanged block are one change', () => {
    const base = [p('a'), p('b'), p('c'), p('d'), p('e'), p('f'), p('g')]
    const cur = [p('a'), p('B'), p('c'), p('D'), p('e'), p('f'), p('G'), p('h')]
    const d = diffBlocks(base, cur)
    const groups = groupChanges(d)
    expect(groups.map((g) => g.blocks)).toEqual([[1, 3], [6, 7]])
    expect(groups[0].key).toBe('b1')
    const withRemoval = diffBlocks([p('a'), p('x'), p('b')], [p('a'), p('b')])
    const g2 = groupChanges(withRemoval)
    expect(g2).toHaveLength(1)
    expect(g2[0].removed).toEqual([1])
    expect(g2[0].blocks).toEqual([])
    expect(g2[0].start).toBe(1)
  })

  it('CH-08: a word diff marks inserted words and deleted ones in place', () => {
    const ops = diffWords('the quick brown fox', 'the slow brown fox jumps')
    expect(ops).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'delete', text: 'quick' },
      { kind: 'insert', text: 'slow' },
      { kind: 'same', text: ' brown fox' },
      { kind: 'insert', text: ' jumps' },
    ])
    expect(diffWords('same', 'same')).toEqual([{ kind: 'same', text: 'same' }])
  })

  it('CH-05, L-30: changed table cells are marked, new rows are added rows', () => {
    const base = [
      ['h1', 'h2'],
      ['a', 'b'],
      ['c', 'd'],
    ]
    const cur = [
      ['h1', 'h2'],
      ['a', 'B'],
      ['c', 'd'],
      ['e', 'f'],
    ]
    const m = diffTable(base, cur)
    expect([...m.changed]).toEqual(['1,1'])
    expect([...m.addedRows]).toEqual([3])
    const reordered = diffTable([['a'], ['b']], [['b'], ['a']])
    expect(reordered.addedRows.size + reordered.changed.size).toBeGreaterThan(0)
  })

  it('CH-07: stepping goes from the current change, or from the middle of the view', () => {
    const placed = [
      { top: 0, bottom: 100 },
      { top: 500, bottom: 600 },
      { top: 1000, bottom: 1100 },
    ]
    expect(nextChange(placed, 0, 0, 800)).toBe(1)
    expect(nextChange(placed, 2, 0, 800)).toBe(2)
    expect(prevChange(placed, 1, 0, 800)).toBe(0)
    expect(nextChange(placed, -1, 0, 800)).toBe(1)
    expect(prevChange(placed, -1, 0, 800)).toBe(0)
    expect(nextChange(placed, -1, 800, 1600)).toBe(2)
    expect(prevChange(placed, -1, 1400, 2200)).toBe(2)
    expect(nextChange([], -1, 0, 100)).toBe(-1)
    expect(onScreen(placed[1], 0, 550)).toBe(true)
    expect(onScreen(placed[1], 601, 900)).toBe(false)
  })

  it('CH-06, CH-07, CH-12: the header count names the baseline and the current change', () => {
    expect(countLabel(3, 'read', -1)).toBe('3 unread changes')
    expect(countLabel(1, 'head', -1)).toBe('1 uncommitted change')
    expect(countLabel(3, 'read', 1)).toBe('Change 2 of 3')
  })

  it('lcs pairs the longest common subsequence', () => {
    expect(lcs(['a', 'b', 'c', 'd'], ['b', 'd', 'e'])).toEqual([
      [1, 0],
      [3, 1],
    ])
  })
})
