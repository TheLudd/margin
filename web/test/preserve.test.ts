import { describe, expect, it } from 'vitest'
import { assemble, normalizeLabel, referencedLabels, splitOriginal, type BlockInfo, type Tools } from '../src/preserve'

// A stand-in for the editor: blocks are separated by blank lines, the
// normal form trims and collapses spaces, "[x]: y" lines are definitions,
// and a block of only "<!-- hidden -->" yields no editor block.
const tools: Tools = {
  blocks(source) {
    const out: BlockInfo[] = []
    const re = /[^\n][\s\S]*?(?=\n\s*\n|$)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(source))) {
      const text = m[0].replace(/\s+$/, '')
      if (!text) continue
      const def = /^\[([^\]]+)\]: /.exec(text)
      out.push({ position: { start: { offset: m.index }, end: { offset: m.index + text.length } }, definition: !!def, identifier: def ? def[1].toLowerCase() : undefined })
    }
    return out
  },
  norms(markdown) {
    return markdown
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b && !/^\[[^\]]+\]: /.test(b) && b !== '<!-- hidden -->')
      .map((b) => b.replace(/\s+/g, ' ').replace(/\[([^\]]+)\]\[[^\]]+\]/g, '[$1](url)'))
  },
}

function blocks(source: string) {
  return splitOriginal(source, tools)
}

function current(...norms: string[]) {
  return norms.map((norm) => ({ norm }))
}

describe('preserve', () => {
  it('D-04, D-05: an unchanged save reproduces the file byte for byte, odd spacing and all', () => {
    const source = '# Title\n\n\nSome   text\n   here.\n\n- a\n- b\n'
    const o = blocks(source)
    expect(o.map((b) => b.norm)).toEqual(['# Title', 'Some text here.', '- a - b'])
    expect(assemble(source, o, current('# Title', 'Some text here.', '- a - b'))).toBe(source)
  })

  it('D-04: a one-word edit changes one block; the others keep their bytes', () => {
    const source = '# Title\n\nSome   text.\n\nLast   para.\n'
    const o = blocks(source)
    expect(assemble(source, o, current('# Title', 'Some text, edited.', 'Last para.'))).toBe('# Title\n\nSome text, edited.\n\nLast   para.\n')
  })

  it('D-04: blocks are matched by structure, not position: a moved block keeps its bytes', () => {
    const source = 'First   one.\n\nSecond   one.\n\nThird   one.\n'
    const o = blocks(source)
    expect(assemble(source, o, current('Third one.', 'First one.', 'Second one.'))).toBe('Third   one.\n\nFirst   one.\n\nSecond   one.\n')
  })

  it('D-04: inserted and removed blocks', () => {
    const source = 'A   a.\n\nB   b.\n\nC   c.\n'
    const o = blocks(source)
    expect(assemble(source, o, current('A a.', 'New block.', 'B b.', 'C c.'))).toBe('A   a.\n\nNew block.\n\nB   b.\n\nC   c.\n')
    expect(assemble(source, o, current('A a.', 'C c.'))).toBe('A   a.\n\nC   c.\n')
    expect(assemble(source, o, current())).toBe('')
  })

  it('D-04: equal blocks are matched nearest first', () => {
    const source = 'Same.\n\nOther   x.\n\nSame.\n'
    const o = blocks(source)
    expect(assemble(source, o, current('Same.', 'Other x.', 'Same.'))).toBe(source)
    expect(assemble(source, o, current('Same.', 'Other x.'))).toBe('Same.\n\nOther   x.\n')
  })

  it('D-05: link definitions, which yield no editor block, stay in place and reference links resolve the same', () => {
    const source = 'See [the docs][ref]   here.\n\n[ref]: https://example.com\n\nMore   text.\n'
    const o = blocks(source)
    expect(o[0].norm).toBe('See [the docs](url) here.')
    expect(o[1].norm).toBeNull()
    expect(assemble(source, o, current('See [the docs](url) here.', 'More text.'))).toBe(source)
    expect(assemble(source, o, current('See [the docs](url) here, edited.', 'More text.'))).toBe('See [the docs](url) here, edited.\n\n[ref]: https://example.com\n\nMore   text.\n')
  })

  it('D-05: only the definitions a block refers to are appended when it is parsed alone', () => {
    const calls: string[] = []
    const spy: Tools = { blocks: tools.blocks, norms: (md) => (calls.push(md), tools.norms(md)) }
    const source = 'Plain   block.\n\nUses [x][ref] here.\n\n[ref]: a\n\n[other]: b\n'
    splitOriginal(source, spy)
    expect(calls[0]).toBe('Plain   block.')
    expect(calls[1]).toBe('Uses [x][ref] here.\n\n[ref]: a')
    expect(normalizeLabel(' Foo  Bar ')).toBe('foo bar')
    expect([...referencedLabels('a [One] and [two][Three] [] x')]).toEqual(['one', 'two', 'three'])
  })

  it('D-04, D-05: leading and trailing bytes of the file are kept, a missing final newline included', () => {
    const source = '\n\nA   a.\n\n\n'
    const o = blocks(source)
    expect(assemble(source, o, current('A a.'))).toBe(source)
    expect(assemble('A a.', blocks('A a.'), current('A a.'))).toBe('A a.')
    expect(assemble('A a.\n', blocks('A a.\n'), current('A a.'))).toBe('A a.\n')
  })

  it('D-05: an empty file stays empty; text written into it gets a final newline', () => {
    expect(assemble('', [], current(''))).toBe('')
    expect(assemble('\n', [], current(''))).toBe('\n')
    expect(assemble('', [], current('New.'))).toBe('New.\n')
  })

  it('D-05: a block indented on its line is taken from the line start, and consecutive definitions keep their separators', () => {
    const indented = '# H\n  * a\n  * b\n'
    const custom: Tools = {
      blocks: () => [
        { position: { start: { offset: 0 }, end: { offset: 3 } }, definition: false },
        { position: { start: { offset: 6 }, end: { offset: 15 } }, definition: false },
      ],
      norms: tools.norms,
    }
    const o = splitOriginal(indented, custom)
    expect(o[1].bytes).toBe('  * a\n  * b')
    expect(assemble(indented, o, current('# H', '* a * b'))).toBe(indented)
    const defs = 'Text [a][a] and [b][b].\n\n[a]: x\n[b]: y\n'
    const o2 = blocks(defs)
    expect(assemble(defs, o2, current('Text [a][a] and [b][b].'.replace(/\[(\w)\]\[\w\]/g, '[$1](url)')))).toBe(defs)
  })

  it('D-04: a separator of a single newline between blocks is kept', () => {
    const source = '# H\ntext   x\n\n- a\n'
    const custom: Tools = {
      blocks: () => [
        { position: { start: { offset: 0 }, end: { offset: 3 } }, definition: false },
        { position: { start: { offset: 4 }, end: { offset: 12 } }, definition: false },
        { position: { start: { offset: 14 }, end: { offset: 17 } }, definition: false },
      ],
      norms: tools.norms,
    }
    const o = splitOriginal(source, custom)
    expect(assemble(source, o, current('# H', 'text x', '- a'))).toBe(source)
    expect(assemble(source, o, current('# H', 'edited', '- a'))).toBe('# H\n\nedited\n\n- a\n')
  })

  it('D-04: hidden blocks stay by their neighbours: after the one before when kept, else before the next, else at the end', () => {
    const source = 'A   a.\n\n<!-- hidden -->\n\nB   b.\n'
    const o = blocks(source)
    expect(o[1].norm).toBeNull()
    expect(assemble(source, o, current('A a.', 'B b.'))).toBe(source)
    expect(assemble(source, o, current('B b.'))).toBe('<!-- hidden -->\n\nB   b.\n')
    expect(assemble(source, o, current('A a.'))).toBe('A   a.\n\n<!-- hidden -->\n')
    expect(assemble(source, o, current('New.'))).toBe('New.\n\n<!-- hidden -->\n')
  })
})
