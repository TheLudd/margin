import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

const paths = ['margin/plan.md', 'mediatool/master/docs/planning-guide.md', 'gaius/README.md', 'margin/web/README.md']

describe('fuzzyScore', () => {
  it('rejects a query that is not a subsequence', () => expect(fuzzyScore('xyz', 'margin/plan.md')).toBeNull())

  it('matches everything with an empty query', () => expect(fuzzyScore('', 'margin/plan.md')).toBe(0))

  it('ignores case and spaces', () => expect(fuzzyScore('Mar Plan', 'margin/plan.md')).not.toBeNull())
})

describe('fuzzyFilter', () => {
  it('ranks a file name match above a scattered match', () =>
    expect(fuzzyFilter('plan', paths, (p) => p, 2)).toEqual(['margin/plan.md', 'mediatool/master/docs/planning-guide.md']))

  it('narrows by directory and name', () => expect(fuzzyFilter('web readme', paths, (p) => p, 1)).toEqual(['margin/web/README.md']))

  it('limits the result', () => expect(fuzzyFilter('', paths, (p) => p, 3)).toHaveLength(3))
})
