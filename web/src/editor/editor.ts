import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewOptionsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { $remark, replaceAll } from '@milkdown/kit/utils'
import type { CodeMirrorFeatureConfig } from '@milkdown/crepe/feature/code-mirror'
import { remarkImageTitle } from './remark-image-title'

export type RenderPreview = NonNullable<CodeMirrorFeatureConfig['renderPreview']>

export interface EditorOptions {
  onChange?: (markdown: string) => void
  renderPreview?: RenderPreview
}

// A WYSIWYG markdown editor bound to one element. Content set through
// `replace` doesn't count as a change.
export interface Editor {
  markdown(): string
  replace(markdown: string): void
  destroy(): Promise<void>
}

export async function createEditor(root: HTMLElement, markdown: string, options: EditorOptions = {}): Promise<Editor> {
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

  let replacing = false
  crepe.on((listener) => {
    listener.markdownUpdated((_, updated) => {
      if (!replacing) options.onChange?.(updated)
    })
  })
  await crepe.create()

  return {
    markdown: () => crepe.getMarkdown(),
    replace(next) {
      replacing = true
      try {
        crepe.editor.action(replaceAll(next, true))
      } finally {
        replacing = false
      }
    },
    async destroy() {
      await crepe.destroy()
    },
  }
}
