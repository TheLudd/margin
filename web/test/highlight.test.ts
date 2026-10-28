import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/highlight'

describe('highlight', () => {
  it('D-18: xml gets its tags, attributes and values as separate runs by offset', () => {
    const code = '<a href="x">hi</a>'
    const runs = tokenize(code, 'xml').map((t) => [code.slice(t.from, t.to), t.className])
    expect(runs).toEqual([
      ['<', 'hljs-tag'],
      ['a', 'hljs-tag hljs-name'],
      [' ', 'hljs-tag'],
      ['href', 'hljs-tag hljs-attr'],
      ['=', 'hljs-tag'],
      ['"x"', 'hljs-tag hljs-string'],
      ['>', 'hljs-tag'],
      ['</', 'hljs-tag'],
      ['a', 'hljs-tag hljs-name'],
      ['>', 'hljs-tag'],
    ])
  })

  it('D-18: an unknown or missing language leaves the code plain', () => {
    expect(tokenize('const x = 1', '')).toEqual([])
    expect(tokenize('const x = 1', 'nosuchlang')).toEqual([])
  })
})
