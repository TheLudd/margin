import { describe, expect, it } from 'vitest'
import { parseRoute, plainClick } from '../src/router'

describe('router', () => {
  it('F-03, C-08: routes are home, settings and documents starting with the root name', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' })
    expect(parseRoute('/settings')).toEqual({ kind: 'settings' })
    expect(parseRoute('/code/margin/plan.md')).toEqual({ kind: 'doc', path: '/code/margin/plan.md' })
    expect(parseRoute('/code/a%20b.md')).toEqual({ kind: 'doc', path: '/code/a b.md' })
    expect(parseRoute('/code')).toEqual({ kind: 'home' })
  })

  it('S-11: only a plain left click opens in place; middle and modified clicks are left to the browser', () => {
    const plain = new MouseEvent('click', { button: 0 })
    const middle = new MouseEvent('auxclick', { button: 1 })
    const ctrl = new MouseEvent('click', { button: 0, ctrlKey: true })
    const shift = new MouseEvent('click', { button: 0, shiftKey: true })
    expect(plainClick(plain)).toBe(true)
    expect(plainClick(middle)).toBe(false)
    expect(plainClick(ctrl)).toBe(false)
    expect(plainClick(shift)).toBe(false)
  })
})
