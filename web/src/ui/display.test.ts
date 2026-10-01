import { describe, expect, it } from 'vitest'
import { display, setRoots } from './display'

describe('display with a single root', () => {
  it('leaves out the root name', () => {
    setRoots(['code'])
    expect(display('code/gaius/plan.md')).toBe('gaius/plan.md')
  })

  it('shows the root itself as empty', () => {
    setRoots(['code'])
    expect(display('code')).toBe('')
  })
})

describe('display with several roots', () => {
  it('keeps the root name', () => {
    setRoots(['code', 'notes'])
    expect(display('notes/ideas.md')).toBe('notes/ideas.md')
  })
})
