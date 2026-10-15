import { describe, expect, it } from 'vitest'
import { joinFrontmatter, splitFrontmatter } from '../src/frontmatter'

describe('frontmatter', () => {
  it('D-06: a leading --- block is split off with its text, and the body follows', () => {
    const s = splitFrontmatter('---\ntitle: x\ntags: [a]\n---\n# Doc\n')
    expect(s.raw).toBe('---\ntitle: x\ntags: [a]\n---\n')
    expect(s.text).toBe('title: x\ntags: [a]')
    expect(s.body).toBe('# Doc\n')
  })

  it('D-06: without frontmatter nothing is split', () => {
    const s = splitFrontmatter('# Doc\n\n---\n\ntext')
    expect(s.raw).toBe('')
    expect(s.body).toBe('# Doc\n\n---\n\ntext')
  })

  it('D-06: untouched frontmatter is reattached byte for byte, edited text goes back between the fences', () => {
    const source = '---  \ntitle: x\n---\nbody\n'
    const s = splitFrontmatter(source)
    expect(joinFrontmatter(s, s.text, 'body\n')).toBe(source)
    expect(joinFrontmatter(s, 'title: y', 'body\n')).toBe('---\ntitle: y\n---\nbody\n')
    expect(joinFrontmatter(splitFrontmatter('body\n'), '', 'body\n')).toBe('body\n')
  })

  it('D-06: an empty frontmatter block and CRLF endings are handled', () => {
    const empty = splitFrontmatter('---\n---\ntext')
    expect(empty.raw).toBe('---\n---\n')
    expect(empty.text).toBe('')
    const crlf = splitFrontmatter('---\r\na: 1\r\n---\r\ntext')
    expect(crlf.text).toBe('a: 1')
    expect(joinFrontmatter(crlf, 'a: 2', 'text')).toBe('---\r\na: 2\r\n---\r\ntext')
  })
})
