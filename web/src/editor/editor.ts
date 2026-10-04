import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx, editorViewOptionsCtx, parserCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose, $remark, replaceAll } from '@milkdown/kit/utils'
import type { CodeMirrorFeatureConfig } from '@milkdown/crepe/feature/code-mirror'
import { changesKey, changesPlugin, type SetBase } from './changes'
import { remarkImageTitle } from './remark-image-title'

// Marks the top-level block holding the cursor, so it is easy to find.
const cursorBlock = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const { $head } = state.selection
          if ($head.depth < 1) return null
          const start = $head.before(1)
          const end = start + state.doc.child($head.index(0)).nodeSize
          return DecorationSet.create(state.doc, [Decoration.node(start, end, { class: 'cursor-block' })])
        },
      },
    }),
)

export type RenderPreview = NonNullable<CodeMirrorFeatureConfig['renderPreview']>

export interface EditorOptions {
  onChange?: (markdown: string) => void
  onChanges?: () => void // the changes shown since the base were recomputed
  renderPreview?: RenderPreview
}

// A WYSIWYG markdown editor bound to one element. Content set through
// `replace` doesn't count as a change.
export interface Editor {
  markdown(): string
  replace(markdown: string): void
  // Shows the changes made since base, a markdown body; undefined hides them.
  compare(base: string | undefined): void
  destroy(): Promise<void>
}

export async function createEditor(root: HTMLElement, markdown: string, options: EditorOptions = {}): Promise<Editor> {
  let replacing = false
  let base: string | undefined // what changes are shown against
  const crepe = await createCrepe(root, markdown, {
    renderPreview: options.renderPreview,
    onChanges: options.onChanges,
    onChange: (updated) => {
      if (!replacing) options.onChange?.(updated)
    },
  })
  const showChanges = () =>
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const meta: SetBase = { base: base === undefined ? undefined : ctx.get(parserCtx)(base) }
      view.dispatch(view.state.tr.setMeta(changesKey, meta))
    })

  return {
    markdown: () => crepe.getMarkdown(),
    replace(next) {
      replacing = true
      try {
        crepe.editor.action(replaceAll(next, true))
      } finally {
        replacing = false
      }
      if (base !== undefined) showChanges() // replacing starts a new state
    },
    compare(next) {
      base = next
      showChanges()
    },
    async destroy() {
      await crepe.destroy()
    },
  }
}

// The configured Crepe instance behind an Editor.
export async function createCrepe(root: HTMLElement, markdown: string, options: EditorOptions = {}): Promise<Crepe> {
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: {
      // `$` is common in prose ("$5") and would be parsed as math.
      [CrepeFeature.Latex]: false,
      [CrepeFeature.AI]: false,
      // Stores its size ratio in the image's alt text.
      [CrepeFeature.ImageBlock]: false,
    },
    featureConfigs: {
      [CrepeFeature.CodeMirror]: {
        renderPreview: options.renderPreview ?? (() => null),
        previewOnlyByDefault: true,
      },
    },
  })
  // Closer to how markdown is usually written, so fewer blocks look changed.
  crepe.editor
    .config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const, rule: '-' as const }))
      // Technical writing is mostly identifiers the spellchecker flags.
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes: { spellcheck: 'false' } }))
    })
    .use($remark('imageTitle', () => remarkImageTitle))
    .use(cursorBlock)
    .use($prose(() => changesPlugin(() => options.onChanges?.())))
  // Otherwise an empty paragraph (an extra Enter) is saved as a `<br />` block.
  await crepe.editor.remove(remarkPreserveEmptyLinePlugin)

  crepe.on((listener) => {
    listener.markdownUpdated((_, updated) => options.onChange?.(updated))
  })
  await crepe.create()
  return crepe
}
