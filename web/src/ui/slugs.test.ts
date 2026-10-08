import { describe, expect, it } from 'vitest'
import { slugs } from './slugs'

describe('slugs', () => {
  it('lowers case and joins words with dashes', () => {
    expect(slugs(['Order of work'])).toEqual(['order-of-work'])
  })

  it('drops punctuation but keeps the spaces around it', () => {
    expect(slugs(['Step 8 — Snapshots', 'lib/types.ts (new)'])).toEqual(['step-8--snapshots', 'libtypests-new'])
  })

  it('keeps letters beyond ascii', () => {
    expect(slugs(['Åtgärder'])).toEqual(['åtgärder'])
  })

  it('numbers repeated headings', () => {
    expect(slugs(['Notes', 'Notes', 'Notes'])).toEqual(['notes', 'notes-1', 'notes-2'])
  })
})
