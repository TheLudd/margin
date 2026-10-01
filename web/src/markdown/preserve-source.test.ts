import { describe, expect, test } from 'vitest'
import { matchBlocks, preserveSource } from './preserve-source'

const original = `# Plan

- one
- two

| a | b |
|---|---|
| 1 | 2 |

Some *text* with [[toc]] in it.
`

// What the editor gives back for the original: same content, its own style.
const normalized = `# Plan

* one
* two

| a | b |
| - | - |
| 1 | 2 |

Some *text* with \\[\\[toc]] in it.
`

describe('preserveSource', () => {
  test('unchanged content keeps the original text', () => {
    expect(preserveSource(original, normalized)).toBe(original)
  })

  test('an edited block is replaced, the rest kept', () => {
    const edited = normalized.replace('* two', '* three')

    expect(preserveSource(original, edited)).toBe(original.replace('- one\n- two', '* one\n* three'))
  })

  test('an inserted block lands between the originals', () => {
    const edited = normalized.replace('# Plan\n', '# Plan\n\nNew paragraph.\n')

    expect(preserveSource(original, edited)).toBe(original.replace('# Plan\n', '# Plan\n\nNew paragraph.\n'))
  })

  test('a deleted block is removed', () => {
    const edited = normalized.replace('* one\n* two\n\n', '')

    expect(preserveSource(original, edited)).toBe(original.replace('- one\n- two\n\n', ''))
  })

  test('original gaps and trailing whitespace are kept', () => {
    const spaced = '# A\n\n\n\nText\n\n\n'

    expect(preserveSource(spaced, '# A\n\nText\n')).toBe(spaced)
  })

  test('indentation of continuation lines is not a change', () => {
    const indented = '- item that\n      wraps here\n'

    expect(preserveSource(indented, '- item that\n  wraps here\n')).toBe(indented)
  })

  test('padding a short table row is not a change', () => {
    const table = '| a | b |\n|---|---|\n| 1 |\n'

    expect(preserveSource(table, '| a | b |\n| - | - |\n| 1 |   |\n')).toBe(table)
  })

  test('a whitespace-only document is kept', () => {
    expect(preserveSource('\n', '')).toBe('\n')
  })

  test('an empty side yields the edited text', () => {
    expect(preserveSource('', '# New\n')).toBe('# New\n')
    expect(preserveSource('# Old\n', '')).toBe('')
  })
})

describe('matchBlocks', () => {
  test.each([
    [['a', 'b', 'c'], ['a', 'b', 'c'], [0, 1, 2]],
    [['a', 'b', 'c'], ['a', 'x', 'c'], [0, -1, 2]],
    [['a', 'b'], ['x', 'a', 'b'], [-1, 0, 1]],
    [['a', 'b', 'c'], ['a', 'c'], [0, 2]],
    [['a', 'a'], ['a'], [0]],
  ])('%j -> %j', (before, after, want) => {
    expect(matchBlocks(before, after)).toEqual(want)
  })
})
