import { describe, expect, it } from 'vitest'
import { align } from './align'

// Items are words; they are alike by their first letter.
const steps = (before: string, after: string) =>
  align(before.split(' ').filter(Boolean), after.split(' ').filter(Boolean), (a, b) => a === b, (a, b) => (a[0] === b[0] ? 1 : 0)).map((s) =>
    s.kind === 'same' ? `=${s.after}` : s.kind === 'changed' ? `${s.before}>${s.after}` : s.kind === 'added' ? `+${s.after}` : `-${s.before}`,
  )

describe('align', () => {
  it('matches the same items', () => expect(steps('a b c', 'a b c')).toEqual(['=a', '=b', '=c']))
  it('finds an added item', () => expect(steps('a c', 'a b c')).toEqual(['=a', '+b', '=c']))
  it('finds a removed item', () => expect(steps('a b c', 'a c')).toEqual(['=a', '-b', '=c']))
  it('pairs a changed item', () => expect(steps('a b c', 'a b2 c')).toEqual(['=a', 'b>b2', '=c']))
  it('pairs the most alike item', () => expect(steps('a b c', 'a x b2 c')).toEqual(['=a', '+x', 'b>b2', '=c']))
  it('pairs unlike items in place', () => expect(steps('a b c', 'a x c')).toEqual(['=a', 'b>x', '=c']))
  it('pairs changed items in order', () => expect(steps('a b c', 'a x y')).toEqual(['=a', 'b>x', 'c>y']))
  it('pairs early on a tie', () => expect(steps('a b', 'a x y')).toEqual(['=a', 'b>x', '+y']))
  it('handles empty versions', () => expect(steps('', 'a')).toEqual(['+a']))
})
