import { beforeEach, describe, expect, it } from 'vitest'
import { type Baseline, Comparison } from './comparison'

let comparison: Comparison
let versions: Partial<Record<Baseline, string>>
let compared: (string | undefined)[]
let available: Baseline[]
let current: Baseline

// A comparison whose baselines are whatever `versions` holds when loading.
function setup(seen: string | undefined, committed: string | undefined) {
  versions = { seen, committed }
  compared = []
  comparison = new Comparison(
    'code/plan.md',
    { seen: async () => versions.seen, committed: async () => versions.committed },
    {
      compare: (body) => compared.push(body),
      baselines: (a, c) => {
        available = a
        current = c
      },
    },
  )
}

describe('Comparison when there are unread changes', () => {
  beforeEach(async () => {
    setup('v1', 'v0')
    await comparison.load('v2')
  })

  it('compares with the version read', () => expect(compared).toEqual(['v1']))
  it('reports it in use', () => expect(current).toBe('seen'))
  it('offers both baselines', () => expect(available).toEqual(['seen', 'committed']))
})

describe('Comparison when only uncommitted changes are left', () => {
  beforeEach(async () => {
    setup('v2', 'v0')
    await comparison.load('v2')
  })

  it('compares with the commit', () => expect(compared).toEqual(['v0']))
  it('reports it in use', () => expect(current).toBe('committed'))
})

describe('Comparison when unread changes arrive while showing uncommitted ones', () => {
  beforeEach(async () => {
    setup('v2', 'v0')
    await comparison.load('v2')
    await comparison.load('v3')
  })

  it('switches to them', () => expect(current).toBe('seen'))
})

describe('Comparison when unread changes are marked read', () => {
  beforeEach(async () => {
    setup('v1', 'v0')
    await comparison.load('v2')
    versions.seen = 'v2'
    await comparison.load('v2')
  })

  it('stays on the version read', () => expect(compared).toEqual(['v1', 'v2']))
})

describe('Comparison when nothing changed', () => {
  beforeEach(async () => {
    setup('v2', 'v2')
    await comparison.load('v2')
  })

  it('compares with the version read', () => expect(current).toBe('seen'))
})

describe('Comparison when the file is not committed', () => {
  beforeEach(async () => {
    setup('v1', undefined)
    await comparison.load('v1')
  })

  it('offers only the version read', () => expect(available).toEqual(['seen']))
})

describe('Comparison when the reader picks a baseline', () => {
  beforeEach(async () => {
    setup('v1', 'v0')
    await comparison.load('v2')
    comparison.use('committed')
    await comparison.load('v3')
  })

  it('keeps it through new changes', () => expect(compared).toEqual(['v1', 'v0', 'v0']))
})

describe('Comparison with frontmatter', () => {
  beforeEach(async () => {
    setup('---\na: 1\n---\nbody\n', undefined)
    await comparison.load('other')
  })

  it('compares the body only', () => expect(compared).toEqual(['body\n']))
})

describe('Comparison without a baseline', () => {
  beforeEach(async () => {
    setup(undefined, undefined)
    await comparison.load('v1')
  })

  it('shows no changes', () => expect(compared).toEqual([undefined]))
  it('offers none', () => expect(available).toEqual([]))
})
