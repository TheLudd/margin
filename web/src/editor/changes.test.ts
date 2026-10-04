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
