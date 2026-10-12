import { beforeEach, describe, expect, it } from 'vitest'
import type { View } from './changes'
import { createEditor, type Editor } from './editor'

let root: HTMLElement
let editor: Editor
let updates: number

// Shown as a diff unless view says otherwise.
async function compare(current: string, base: string | undefined, view: View = 'diff') {
  root = document.body.appendChild(document.createElement('div'))
  updates = 0
  editor = await createEditor(root, current, { onChanges: () => updates++, changeView: view })
  editor.compare(base)
}

const texts = (selector: string) => [...root.querySelectorAll(selector)].map((e) => e.textContent)

describe('compare when a word is replaced', () => {
  beforeEach(() => compare('one four three\n', 'one two three\n'))

  it('highlights the new word', () => expect(texts('.change-inserted')).toEqual(['four']))
  it('shows the old word struck through', () => expect(texts('del.change-deleted')).toEqual(['two']))
  it('marks the block', () => expect(root.querySelectorAll('.change-block').length).toBe(1))
  it('reports the update', () => expect(updates).toBe(1))
})

describe('compare when a block is removed', () => {
  beforeEach(() => compare('a\n\nc\n', 'a\n\nb\n\nc\n'))

  it('shows the removed block', () => expect(texts('.change-removed')).toEqual(['b']))
  it('marks no remaining block', () => expect(texts('.change-block')).toEqual([]))
})

describe('compare when a block is added', () => {
  beforeEach(() => compare('a\n\nb\n\nc\n', 'a\n\nc\n'))

  it('marks the new block', () => expect(texts('.change-block')).toEqual(['b']))
  it('leaves it to its bar', () => expect(texts('.change-inserted')).toEqual([]))
})

describe('compare when a list item changes', () => {
  beforeEach(() => compare('- a\n- one two six\n- c\n', '- a\n- one two three\n- c\n'))

  it('marks only that item', () => expect(texts('.change-block')).toEqual(['one two threesix']))
})

describe('compare when most of a block is rewritten', () => {
  beforeEach(() => compare('a\n\nfour five six\n', 'a\n\none two three\n'))

  it('shows the old block whole', () => expect(texts('.change-removed')).toEqual(['one two three']))
  it('leaves the new block to its bar', () => expect(texts('.change-inserted')).toEqual([]))
  it('strikes through no words', () => expect(texts('.change-deleted')).toEqual([]))
  it('numbers both as one change', () => expect(numbered()).toEqual([['0', 'one two three'], ['0', 'four five six']]))
})

describe('compare when new blocks replace an old one', () => {
  beforeEach(() => compare('# A\n\n## B\n\n- one\n- two\n\nthree\n\n# C\n', '# A\n\nold text\n\n# C\n'))

  it('shows the old block once', () => expect(texts('.change-removed')).toEqual(['old text']))
})

describe('compare when a block is added after a changed one', () => {
  beforeEach(() => compare('one four three\n\nnew block\n', 'one two three\n'))

  it('highlights only the changed words', () => expect(texts('.change-inserted')).toEqual(['four']))
})

describe('a rewritten block shown as it is now', () => {
  beforeEach(async () => {
    await compare('a\n\nfour five six\n', 'a\n\none two three\n')
    show(0, '+')
  })

  it('leaves out the old block', () => expect(texts('.change-removed')).toEqual([]))
})

describe('compare when one short word separates changes', () => {
  beforeEach(() => compare('gamma a delta and the rest stays\n', 'alpha a beta and the rest stays\n'))

  it('highlights them as one', () => expect(texts('.change-inserted')).toEqual(['gamma a delta']))
  it('strikes them through as one', () => expect(texts('.change-deleted')).toEqual(['alpha a beta']))
})

describe('compare when a longer word separates changes', () => {
  beforeEach(() => compare('one X three Y and the rest stays\n', 'one two three four and the rest stays\n'))

  it('keeps them apart', () => expect(texts('.change-inserted')).toEqual(['X', 'Y']))
})

describe('compare when only whitespace moves', () => {
  beforeEach(() => compare('a `b` c\n', 'a `b `c\n'))

  it('shows no changes', () => expect(root.querySelectorAll('[class*="change-"]').length).toBe(0))
})

describe('compare when inline code is deleted', () => {
  beforeEach(() => compare('one three\n', 'one `two` three\n'))

  it('strikes it through as code', () => expect(texts('del.change-deleted code')).toEqual(['two']))
})

describe('compare with the same document', () => {
  beforeEach(() => compare('a\n\nb\n', 'a\n\nb\n'))

  it('shows no changes', () => expect(root.querySelectorAll('[class*="change-"]').length).toBe(0))
})

describe('compare to nothing after comparing', () => {
  beforeEach(async () => {
    await compare('one four three\n', 'one two three\n')
    editor.compare(undefined)
  })

  it('hides the changes', () => expect(root.querySelectorAll('[class*="change-"]').length).toBe(0))
})

describe('compare when the document is replaced', () => {
  beforeEach(async () => {
    await compare('one two three\n', 'one two three\n')
    editor.replace('one two three four\n')
  })

  it('shows the new changes', () => expect(texts('.change-inserted')).toEqual([' four']))
  it('reports the update', () => expect(updates).toBeGreaterThan(1))
})

const numbered = () => [...root.querySelectorAll<HTMLElement>('[data-change]')].map((e) => [e.dataset.change, e.textContent])

describe('compare when blocks are removed and changed', () => {
  beforeEach(() => compare('a\n\nc\n\nx\n\nd2\n', 'a\n\nb\n\nc\n\nx\n\nd\n'))

  it('numbers the changes in document order', () => expect(numbered()).toEqual([['0', 'b'], ['1', 'd2']]))
})

describe('compare when changed blocks are next to each other', () => {
  beforeEach(() => compare('a2\n\nb2\n', 'a\n\nb\n'))

  it('groups them', () => expect(numbered()).toEqual([['0', 'a2'], ['0', 'b2']]))
})

describe('compare when one unchanged block separates changes', () => {
  beforeEach(() => compare('a2\n\nx\n\nb2\n', 'a\n\nx\n\nb\n'))

  it('groups them', () => expect(numbered()).toEqual([['0', 'a2'], ['0', 'b2']]))
})

describe('compare when two unchanged blocks separate changes', () => {
  beforeEach(() => compare('a2\n\nx\n\ny\n\nb2\n', 'a\n\nx\n\ny\n\nb\n'))

  it('keeps them apart', () => expect(numbered()).toEqual([['0', 'a2'], ['1', 'b2']]))
})

describe('compare when a new section comes before a changed block', () => {
  beforeEach(() => compare('# A\n\n# B\n\nnew\n\n# C\n\nc2\n', '# A\n\n# C\n\nc\n'))

  it('groups them across the heading', () => expect(new Set(numbered().map(([group]) => group))).toEqual(new Set(['0'])))
})

describe('focusChange on a changed block', () => {
  beforeEach(async () => {
    await compare('a2\n\nx\n\ny\n\nb2\n', 'a\n\nx\n\ny\n\nb\n')
    editor.focusChange({ index: 1, pulse: true })
  })

  it('marks it current', () => expect(texts('.change-current')).toEqual(['b2']))
  it('pulses it', () => expect(texts('.change-pulse')).toEqual(['b2']))
})

describe('focusChange on removed blocks', () => {
  beforeEach(async () => {
    await compare('a\n\nc\n', 'a\n\nb\n\nc\n')
    editor.focusChange({ index: 0, pulse: false })
  })

  it('marks them current', () => expect(texts('.change-removed.change-current')).toEqual(['b']))
  it('does not pulse them', () => expect(root.querySelectorAll('.change-pulse').length).toBe(0))
})

describe('focusChange to nothing', () => {
  beforeEach(async () => {
    await compare('a2\n', 'a\n')
    editor.focusChange({ index: 0, pulse: false })
    editor.focusChange(undefined)
  })

  it('leaves no change current', () => expect(root.querySelectorAll('.change-current').length).toBe(0))
})

// Clicks the view button of the change with that index.
const show = (index: number, label: '+' | '±' | '−') =>
  [...root.querySelectorAll<HTMLElement>('.change-controls')][index].querySelectorAll('button').forEach((b) => b.textContent === label && b.click())

describe('a changed block shown as it is now', () => {
  beforeEach(async () => {
    await compare('one four three\n', 'one two three\n')
    show(0, '+')
  })

  it('leaves out the deleted words', () => expect(texts('.change-deleted')).toEqual([]))
  it('leaves out the highlights', () => expect(texts('.change-inserted')).toEqual([]))
  it('keeps the bar', () => expect(texts('.change-block')).toEqual(['one four three']))
})

describe('a changed block shown as it was', () => {
  beforeEach(async () => {
    await compare('a\n\none four three\n', 'a\n\none two three\n')
    show(0, '−')
  })

  it('shows the old block', () => expect(texts('.change-old')).toEqual(['one two three']))
  it('hides the new one', () => expect(texts('.change-hidden')).toEqual(['one four three']))
  it('numbers the old block as the change', () => expect(numbered()).toEqual([['0', 'one two three']]))
})

describe('a new block shown as it was', () => {
  beforeEach(async () => {
    await compare('a\n\nb\n', 'a\n')
    show(0, '−')
  })

  it('says there was nothing', () => expect(texts('.change-old .change-note')).toEqual(['Not in the old version']))
})

describe('removed blocks shown as it is now', () => {
  beforeEach(async () => {
    await compare('a\n\nc\n', 'a\n\nb\n\nc\n')
    show(0, '+')
  })

  it('collapses them', () => expect(texts('.change-removed.change-collapsed')).toEqual(['']))
})

describe('a changed block shown as it was, then as a diff', () => {
  beforeEach(async () => {
    await compare('one four three\n', 'one two three\n')
    show(0, '−')
    show(0, '±')
  })

  it('shows the changes again', () => expect(texts('.change-inserted')).toEqual(['four']))
  it('shows the document block again', () => expect(root.querySelectorAll('.change-hidden, .change-old').length).toBe(0))
})

describe('a changed block shown as it is now, compared again with the same base', () => {
  beforeEach(async () => {
    await compare('one four three\n', 'one two three\n')
    show(0, '+')
    editor.compare('one two three\n')
  })

  it('stays as it is now', () => expect(texts('.change-inserted')).toEqual([]))
})

describe('a changed block shown as it is now, compared with a new base', () => {
  beforeEach(async () => {
    await compare('one four three\n', 'one two three\n')
    show(0, '+')
    editor.compare('one five three\n')
  })

  it('shows the changes again', () => expect(texts('.change-inserted')).toEqual(['four']))
})

describe('a group shown as it is now', () => {
  beforeEach(async () => {
    await compare('one four\n\nfive six\n', 'one two\n\nthree six\n')
    show(0, '+')
  })

  it('shows all of it as it is now', () => expect(texts('.change-inserted')).toEqual([]))
})

const classed = (selector: string) => [...root.querySelectorAll(selector)].map((e) => e.textContent)

describe('compare shown as it is now by default', () => {
  beforeEach(() => compare('one four three\n', 'one two three\n', 'new'))

  it('marks the block', () => expect(texts('.change-block')).toEqual(['one four three']))
  it('shows no words', () => expect(root.querySelectorAll('.change-inserted, .change-deleted').length).toBe(0))
})

describe('compare when a block is added and another changed', () => {
  beforeEach(() => compare('a\n\nb\n\nc\n\none four three\n', 'a\n\nc\n\none two three\n', 'new'))

  it('marks the new one as added', () => expect(classed('.change-block.change-added')).toEqual(['b']))
  it('marks the changed one as modified', () => expect(classed('.change-block.change-modified')).toEqual(['one four three']))
})

describe('compare when a block is added before a changed one', () => {
  beforeEach(() =>
    compare(
      'a\n\nA brand new paragraph, added here.\n\nThe second paragraph about the new plan.\n',
      'a\n\nThe second paragraph about the old plan.\n',
    ),
  )

  it('marks the new one as added', () => expect(classed('.change-block.change-added')).toEqual(['A brand new paragraph, added here.']))
  it('marks the changed one as modified', () => expect(texts('.change-block.change-modified')).toEqual(['The second paragraph about the oldnew plan.']))
  it('removes nothing', () => expect(texts('.change-removed')).toEqual([]))
})

describe('compare when a line of code changes', () => {
  const code = (b: string) => `x\n\n\`\`\`js\nconst a = 1\nconst b = ${b}\n\`\`\`\n`
  beforeEach(() => compare(code('3'), code('2')))

  it('marks the code block as modified', () => expect(root.querySelectorAll('.change-block.change-modified').length).toBe(1))
  it('shows the old code above it', () => expect(texts('.change-removed.change-plain')).toEqual(['const a = 1\nconst b = 2']))
})

const table = (...rows: string[]) => `| a | b |\n| - | - |\n${rows.map((r) => `| ${r.split(' ').join(' | ')} |\n`).join('')}`

describe('compare when a table cell changes', () => {
  beforeEach(() => compare(table('1 2', '3 4x'), table('1 2', '3 4'), 'new'))

  it('marks the table as modified', () => expect(root.querySelectorAll('.milkdown-table-block.change-block.change-modified').length).toBe(1))
  it('tints the cell', () => expect(texts('.change-cell')).toEqual(['4x']))
  it('puts its buttons outside the table', () => expect(root.querySelectorAll('table .change-controls').length).toBe(0))
  it('shows no words', () => expect(root.querySelectorAll('.change-inserted, .change-deleted').length).toBe(0))
})

describe('compare when a table row is added', () => {
  beforeEach(() => compare(table('1 2', '5 6', '3 4'), table('1 2', '3 4'), 'new'))

  it('tints its cells as added', () => expect(texts('.change-cell.change-cell-added')).toEqual(['5', '6']))
  it('tints no other cells', () => expect(texts('.change-cell')).toEqual(['5', '6']))
})

describe('compare when a table row is changed and one added', () => {
  beforeEach(() => compare(table('1 2x', '5 6', '3 4'), table('1 2', '3 4'), 'new'))

  it('tints the changed cell', () => expect(texts('.change-cell:not(.change-cell-added)')).toEqual(['2x']))
  it('tints the new row as added', () => expect(texts('.change-cell-added')).toEqual(['5', '6']))
})

describe('compare when a table row is removed', () => {
  beforeEach(() => compare(table('1 2'), table('1 2', '3 4')))

  it('counts one change', () => expect(new Set(numbered().map(([group]) => group))).toEqual(new Set(['0'])))
  it('shows the old table above it', () => expect(root.querySelectorAll('.change-removed.change-plain table').length).toBe(1))
  it('draws nothing inside the table', () => expect(root.querySelectorAll('table [class*="change-"]').length).toBe(0))
})

describe('compare when a table is added', () => {
  beforeEach(() => compare(`x\n\n${table('1 2')}`, 'x\n', 'new'))

  it('marks it as added', () => expect(root.querySelectorAll('.milkdown-table-block.change-block.change-added').length).toBe(1))
  it('tints no cells', () => expect(root.querySelectorAll('.change-cell').length).toBe(0))
})

describe('compare when a rule is added', () => {
  beforeEach(() => compare('a\n\n---\n\nb\n', 'a\n\nb\n', 'new'))

  it('marks it as added', () => expect(root.querySelectorAll('hr.change-block.change-added').length).toBe(1))
})
