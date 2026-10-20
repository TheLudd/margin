import { describe, expect, it } from 'vitest'
import { countLabel, diffLines, diffRows, diffUnits, diffWords, lcs, listChanges, nextChange, onScreen, prevChange, similarity, type Unit } from '../src/changes'

function p(text: string, kind: Unit['kind'] = 'paragraph'): Unit {
  return { norm: text, kind, text }
}

function code(...lines: string[]): Unit {
  return { norm: lines.join('\n'), kind: 'code_block', text: lines.join('\n'), lines }
}

function table(...rows: string[][]): Unit {
  const text = rows.map((r) => r.join(' | ')).join('\n')
  return { norm: text, kind: 'table', text, rows }
}

describe('changes', () => {
  it('CH-05: equal units pair up; new units are added, missing ones removed', () => {
    const base = [p('a'), p('b'), p('c')]
    const cur = [p('a'), p('c'), p('d')]
    const d = diffUnits(base, cur)
    expect(d.units.map((b) => b.mark)).toEqual(['same', 'same', 'added'])
    expect(d.removed).toEqual([{ baseline: 1, before: 1 }])
  })

  it('CH-05: a unit with enough shared words is modified, not removed and added', () => {
    const base = [p('The quick brown fox jumps over the lazy dog')]
    const cur = [p('The quick brown fox jumps over the sleepy dog')]
    const d = diffUnits(base, cur)
    expect(d.units).toEqual([{ mark: 'modified', baseline: 0 }])
    expect(d.removed).toEqual([])
    expect(similarity('a b c', 'a b d')).toBeCloseTo(2 / 3)
    expect(similarity('', '')).toBe(1)
  })

  it('CH-05: a code block or table pairs with the next of its kind when its text changed', () => {
    const base = [code('const x = 1'), table(['a'])]
    const cur = [code('const x = 2'), table(['b'])]
    const d = diffUnits(base, cur)
    expect(d.units.map((b) => b.mark)).toEqual(['modified', 'modified'])
  })

  it('CH-05: a unit rewritten beyond recognition in place of another of its kind is modified, a rewrite being one change', () => {
    const base = [p('a'), p('one two three four'), p('b')]
    const cur = [p('a'), p('five six seven eight'), p('b')]
    expect(diffUnits(base, cur).units[1]).toEqual({ mark: 'modified', baseline: 1 })
    const two = diffUnits([p('a'), p('one two'), p('three four'), p('b')], [p('a'), p('five six'), p('seven eight'), p('b')])
    expect(two.units.map((u) => u.mark)).toEqual(['same', 'modified', 'modified', 'same'])
    const uneven = diffUnits([p('a'), p('one two'), p('b')], [p('a'), p('five six'), p('seven eight'), p('b')])
    expect(uneven.units.map((u) => u.mark)).toEqual(['same', 'added', 'added', 'same'])
    expect(uneven.removed).toEqual([{ baseline: 1, before: 1 }])
    // Also between two units that paired by their words.
    const between = diffUnits([p('x'), p('one two three'), p('four five six'), p('seven eight nine'), p('y')], [p('x'), p('one two ten'), p('other words here'), p('seven eight ten'), p('y')])
    expect(between.units.map((u) => u.mark)).toEqual(['same', 'modified', 'modified', 'modified', 'same'])
    expect(between.removed).toEqual([])
  })

  it('CH-05: units of different kinds never pair as modified', () => {
    const d = diffUnits([p('same words here', 'heading')], [p('same words here now', 'paragraph')])
    expect(d.units[0].mark).toBe('added')
    expect(d.removed).toEqual([{ baseline: 0, before: 0 }])
  })

  it('CH-06: every changed, new or removed unit is its own change, in document order, whatever lies between', () => {
    const base = [p('a'), p('b'), p('c'), p('d'), p('e'), p('f'), p('g')]
    const cur = [p('a'), p('B'), p('c'), p('D'), p('e'), p('f'), p('G'), p('h')]
    const d = diffUnits(base, cur)
    const changes = listChanges(d, base, cur)
    expect(changes.map((c) => [c.kind, c.unit])).toEqual([
      ['modified', 1],
      ['modified', 3],
      ['modified', 6],
      ['added', 7],
    ])
    const gone = [p('a'), p('x y z'), p('b'), p('c')]
    const goneNow = [p('a'), p('b'), p('one two'), p('c')]
    expect(listChanges(diffUnits(gone, goneNow), gone, goneNow).map((c) => [c.kind, c.unit])).toEqual([
      ['removed', 1],
      ['added', 2],
    ])
    const long = [p('one two three four'), p('x'), p('five six seven eight')]
    const longNow = [p('one two three four more'), p('x'), p('five six seven eight more')]
    const c2 = listChanges(diffUnits(long, longNow), long, longNow)
    expect(c2.map((c) => [c.kind, c.key])).toEqual([
      ['modified', 'b0'],
      ['modified', 'b2'],
    ])
  })

  it('CH-05, CH-06: each hunk of a changed code block is a change of its own', () => {
    const base = [code('a', 'b', 'c', 'd', 'e')]
    const cur = [code('a', 'B', 'c', 'd', 'e', 'f')]
    const changes = listChanges(diffUnits(base, cur), base, cur)
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ kind: 'lines', unit: 0, baseline: 0, hunk: { from: 1, to: 2, oldFrom: 1, oldTo: 2 }, key: 'b0h1', viewKey: 'b0' })
    expect(changes[1]).toMatchObject({ kind: 'lines', hunk: { from: 5, to: 6, oldFrom: 5, oldTo: 5 } })
    expect(diffLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ from: 1, to: 1, oldFrom: 1, oldTo: 2 }])
    // A code block whose text differs only outside its lines is one change.
    const same = [{ ...code('a'), norm: '```js\na\n```' }]
    const sameNow = [{ ...code('a'), norm: '```ts\na\n```' }]
    expect(listChanges(diffUnits(same, sameNow), same, sameNow).map((c) => c.kind)).toEqual(['modified'])
  })

  it('CH-05, CH-06, L-30: each changed, new or removed row of a table is a change of its own, with the cells that changed', () => {
    const base = [table(['h1', 'h2'], ['a', 'b'], ['c', 'd'], ['x', 'y'])]
    const cur = [table(['h1', 'h2'], ['a', 'B'], ['c', 'd'], ['e', 'f'])]
    const changes = listChanges(diffUnits(base, cur), base, cur)
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ kind: 'row', row: 1, baselineRow: 1, cells: [1], key: 'b0r1', viewKey: 'b0' })
    expect(changes[1]).toMatchObject({ kind: 'row', row: 3, baselineRow: 3, cells: [0, 1] })
    const added = [table(['h'], ['a'])]
    const addedNow = [table(['h'], ['a'], ['b'])]
    expect(listChanges(diffUnits(added, addedNow), added, addedNow)).toMatchObject([{ kind: 'row', row: 2, baselineRow: null, cells: [0] }])
    const gone = diffRows([['h'], ['a'], ['b']], [['h'], ['b']])
    expect(gone.removed).toEqual([{ baselineRow: 1, before: 1 }])
    const reordered = diffRows([['a'], ['b']], [['b'], ['a']])
    expect(reordered.added.length + reordered.changed.size).toBeGreaterThan(0)
    // Rows pair by the cells they share before they pair by order.
    const shared = diffRows([['h', 'n'], ['one', '1'], ['two', '2'], ['three', '3']], [['h', 'n'], ['two', '22'], ['three', '3'], ['four', '4']])
    expect(shared.paired.get(1)).toBe(2)
    expect(shared.paired.get(2)).toBe(3)
    expect(shared.paired.size).toBe(3)
    expect(shared.removed).toEqual([{ baselineRow: 1, before: 1 }])
    expect(shared.added).toEqual([3])
    expect([...shared.changed]).toEqual(['1,1'])
  })

  it('CH-08: a word diff marks inserted words and deleted ones in place, keeping the space between two inserts with them', () => {
    const ops = diffWords('the quick brown fox', 'the slow brown fox jumps')
    expect(ops).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'delete', text: 'quick' },
      { kind: 'insert', text: 'slow' },
      { kind: 'same', text: ' brown fox' },
      { kind: 'insert', text: ' jumps' },
    ])
    expect(diffWords('same', 'same')).toEqual([{ kind: 'same', text: 'same' }])
    expect(diffWords('a b c', 'a x b y c')).toEqual([
      { kind: 'same', text: 'a ' },
      { kind: 'insert', text: 'x ' },
      { kind: 'same', text: 'b ' },
      { kind: 'insert', text: 'y ' },
      { kind: 'same', text: 'c' },
    ])
    expect(diffWords('one two three', 'one four five')).toEqual([
      { kind: 'same', text: 'one ' },
      { kind: 'delete', text: 'two three' },
      { kind: 'insert', text: 'four five' },
    ])
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
