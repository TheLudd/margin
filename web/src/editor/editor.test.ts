import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCrepe, createEditor } from './editor'

let crepe: Crepe

const mount = () => document.body.appendChild(document.createElement('div'))

describe('createCrepe when an empty paragraph is added', () => {
  beforeEach(async () => {
    crepe = await createCrepe(mount(), '- a\n- b\n\npara\n')
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { state } = view
      view.dispatch(state.tr.insert(state.doc.firstChild!.nodeSize, state.schema.nodes.paragraph.create()))
    })
  })

  it('does not save it as <br />', () => expect(crepe.getMarkdown()).not.toContain('<br />'))
})

describe('createCrepe with a <br /> in the source', () => {
  beforeEach(async () => {
    crepe = await createCrepe(mount(), 'a\n\n<br />\n\nb\n')
  })

  it('keeps it', () => expect(crepe.getMarkdown()).toContain('<br />'))
})

// Holds back what is in view until shown, as code blocks only set up
// CodeMirror once seen.
const observed: [IntersectionObserverCallback, Element][] = []
class Visibility {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    observed.push([this.callback, target])
  }
  unobserve() {}
  disconnect() {}
}
const showAll = () => {
  for (const [callback, target] of observed) callback([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
}

describe('createEditor when editing starts after reading', () => {
  let root: HTMLElement

  beforeEach(async () => {
    vi.stubGlobal('IntersectionObserver', Visibility)
    root = mount()
    const editor = await createEditor(root, '```ts\nconst a = 1\n```\n')
    editor.setReadonly(true)
    showAll()
    editor.setReadonly(false)
  })

  it('makes code blocks editable', () => expect(root.querySelector('.cm-content')?.hasAttribute('aria-readonly')).toBe(false))
})
