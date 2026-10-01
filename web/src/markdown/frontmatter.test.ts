import { describe, expect, test } from 'vitest'
import { joinFrontmatter, splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  test.each([
    ['skill file', '---\nname: x\ndescription: y\n---\n# Body\n', '---\nname: x\ndescription: y\n---\n', '# Body\n'],
    ['empty frontmatter', '---\n---\nbody', '---\n---\n', 'body'],
    ['crlf', '---\r\na: 1\r\n---\r\nbody', '---\r\na: 1\r\n---\r\n', 'body'],
    ['only frontmatter', '---\na: 1\n---', '---\na: 1\n---', ''],
    ['none', '# Title\n', '', '# Title\n'],
    ['thematic break later', 'text\n---\nmore\n---\n', '', 'text\n---\nmore\n---\n'],
    ['unclosed', '---\na: 1\n', '', '---\na: 1\n'],
  ])('%s', (_, markdown, frontmatter, body) => {
    expect(splitFrontmatter(markdown)).toEqual({ frontmatter, body })
    expect(joinFrontmatter({ frontmatter, body })).toBe(markdown)
  })
})
