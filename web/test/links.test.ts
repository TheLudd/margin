import { describe, expect, it } from 'vitest'
import { isMarkdownLink, resolveMarkdownLink } from '../src/links'

describe('links', () => {
  it('D-13: a link to a .md file is one margin can open; others are not', () => {
    expect(isMarkdownLink('other.md')).toBe(true)
    expect(isMarkdownLink('../docs/guide.md#intro')).toBe(true)
    expect(isMarkdownLink('/code/foo/a.md')).toBe(true)
    expect(isMarkdownLink('https://example.com/x.md')).toBe(false)
    expect(isMarkdownLink('image.png')).toBe(false)
    expect(isMarkdownLink('https://example.com')).toBe(false)
  })

  it('D-13: a relative link resolves against the open file\'s folder, never above the root', () => {
    expect(resolveMarkdownLink('other.md', '/code/foo/docs/a.md')).toBe('/code/foo/docs/other.md')
    expect(resolveMarkdownLink('../readme.md', '/code/foo/docs/a.md')).toBe('/code/foo/readme.md')
    expect(resolveMarkdownLink('./x/y.md#top', '/code/foo/a.md')).toBe('/code/foo/x/y.md#top')
    expect(resolveMarkdownLink('/code/bar/b.md', '/code/foo/a.md')).toBe('/code/bar/b.md')
    expect(resolveMarkdownLink('../../../escape.md', '/code/foo/a.md')).toBe('/code/escape.md')
    expect(resolveMarkdownLink('a%20b.md', '/code/foo/a.md')).toBe('/code/foo/a b.md')
  })
})
