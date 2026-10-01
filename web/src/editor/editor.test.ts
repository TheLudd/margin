import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCrepe } from './editor'

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
