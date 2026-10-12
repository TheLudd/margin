import { beforeEach, describe, expect, it } from 'vitest'
import { EditMode } from './edit-mode'

let mode: EditMode
let reported: boolean[]
let page: HTMLElement

beforeEach(() => {
  page = document.createElement('div')
  reported = []
  mode = new EditMode((editing) => reported.push(editing), page)
  page.append(mode.el)
})

const press = (key: string, target: EventTarget = page, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

describe('EditMode', () => {
  it('starts reading', () => expect(mode.editing).toBe(false))

  it('starts editing on E', () => {
    press('e')
    expect(reported).toEqual([true])
  })

  it('ignores E typed into a field', () => {
    const input = page.appendChild(document.createElement('input'))
    press('e', input)
    expect(reported).toEqual([])
  })

  it('ignores E with a modifier', () => {
    press('e', page, { ctrlKey: true })
    expect(reported).toEqual([])
  })

  it('toggles from the button', () => {
    mode.el.click()
    mode.el.click()
    expect(reported).toEqual([true, false])
  })

  it('says it is editing', () => {
    mode.set(true)
    expect([mode.el.textContent, mode.el.classList.contains('active')]).toEqual(['editing', true])
  })

  it('reads again after a reset, without reporting it', () => {
    mode.set(true)
    mode.reset()
    expect([mode.editing, reported]).toEqual([false, [true]])
  })

  it('stops editing when no longer available', () => {
    mode.set(true)
    mode.setAvailable(false)
    expect([mode.editing, mode.el.hidden]).toEqual([false, true])
  })

  it('does not start editing while unavailable', () => {
    mode.setAvailable(false)
    press('e')
    expect(reported).toEqual([])
  })
})
