import { beforeEach, describe, expect, it } from 'vitest'
import { createEditor, type Editor } from './editor'

let root: HTMLElement
let editor: Editor
let updates: number

async function compare(current: string, base: string | undefined) {
  root = document.body.appendChild(document.createElement('div'))
  updates = 0
  editor = await createEditor(root, current, { onChanges: () => updates++ })
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
})

describe('compare when a list item changes', () => {
  beforeEach(() => compare('- a\n- x\n- c\n', '- a\n- b\n- c\n'))

  it('marks only that item', () => expect(texts('.change-block')).toEqual(['bx']))
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
  beforeEach(() => compare('a\n\nc\n\nd2\n', 'a\n\nb\n\nc\n\nd\n'))

  it('numbers the changes in document order', () => expect(numbered()).toEqual([['0', 'b'], ['1', 'd2']]))
})

describe('focusChange on a changed block', () => {
  beforeEach(async () => {
    await compare('a2\n\nb2\n', 'a\n\nb\n')
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
