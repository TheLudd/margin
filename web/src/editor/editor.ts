import { Crepe, CrepeFeature } from '@milkdown/crepe'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx, editorViewOptionsCtx, parserCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $remark, replaceAll } from '@milkdown/kit/utils'
import type { CodeMirrorFeatureConfig } from '@milkdown/crepe/feature/code-mirror'
import { type ChangesMeta, changesKey, changesPlugin, type Focus, type View } from './changes'
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

// Code blocks are CodeMirror editors that only pick up whether the document
// is editable when they are redrawn, which switching modes alone doesn't do.
// Marking them with the mode redraws them on every switch.
const editableKey = new PluginKey<DecorationSet>('editable')
const codeBlocksEditable = $prose(
  () =>
    new Plugin({
      key: editableKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const editable = tr.getMeta(editableKey) as boolean | undefined
          if (editable === undefined) return set.map(tr.mapping, tr.doc)
          const marks: Decoration[] = []
          tr.doc.descendants((node, pos) => {
            if (node.type.name === 'code_block') marks.push(Decoration.node(pos, pos + node.nodeSize, { 'data-editable': `${editable}` }))
          })
          return DecorationSet.create(tr.doc, marks)
        },
      },
      props: {
        decorations: (state) => editableKey.getState(state),
      },
    }),
)

export type RenderPreview = NonNullable<CodeMirrorFeatureConfig['renderPreview']>

export interface EditorOptions {
  onChange?: (markdown: string) => void
  onChanges?: () => void // the changes shown since the base were recomputed
  changeView?: View // how changes are shown until the reader picks otherwise; as it is now by default
  renderPreview?: RenderPreview
}

// A WYSIWYG markdown editor bound to one element. Content set through
// `replace` doesn't count as a change.
export interface Editor {
  markdown(): string
  replace(markdown: string): void
  // Shows the changes made since base, a markdown body; undefined hides them.
  compare(base: string | undefined): void
  // Highlights the change with that index, as numbered in data-change.
  focusChange(focus: Focus | undefined): void
  setReadonly(readonly: boolean): void
  // Makes the editor editable and puts the cursor where the reader selected
  // or clicked while reading, or else at the top of the view.
  edit(): void
  destroy(): Promise<void>
}

export async function createEditor(root: HTMLElement, markdown: string, options: EditorOptions = {}): Promise<Editor> {
  let replacing = false
  let base: string | undefined // what changes are shown against
  const crepe = await createCrepe(root, markdown, {
    renderPreview: options.renderPreview,
    changeView: options.changeView,
    onChanges: options.onChanges,
    onChange: (updated) => {
      if (!replacing) options.onChange?.(updated)
    },
  })
  const setChanges = (meta: (ctx: Ctx) => ChangesMeta) =>
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(changesKey, meta(ctx)))
    })
  const setEditable = (editable: boolean) => {
    crepe.setReadonly(!editable)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(editableKey, editable))
    })
  }
  const showChanges = () => setChanges((ctx) => ({ base: base === undefined ? undefined : ctx.get(parserCtx)(base) }))

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
    focusChange(focus) {
      setChanges(() => ({ focus }))
    },
    setReadonly(readonly) {
      setEditable(!readonly)
    },
    edit() {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const selection = readSelection(view) ?? topOfView(view)
        setEditable(true)
        view.focus()
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
      })
    },
    async destroy() {
      await crepe.destroy()
    },
  }
}

// The text selected in the document while it was read-only, if any.
function readSelection(view: EditorView): Selection | undefined {
  const selection = document.getSelection()
  if (!selection?.anchorNode || !selection.focusNode) return undefined
  if (!view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return undefined
  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset)
    return TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head))
  } catch {
    return undefined // a node ProseMirror doesn't describe, such as a widget
  }
}

// The start of the first block in view.
function topOfView(view: EditorView): Selection {
  const box = view.dom.getBoundingClientRect()
  const found = view.posAtCoords({ left: box.left + box.width / 2, top: Math.max(box.top, 0) + 80 })
  if (!found) return Selection.atStart(view.state.doc)
  return Selection.near(view.state.doc.resolve(found.pos))
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
    .use(codeBlocksEditable)
    .use($prose(() => changesPlugin(options.changeView ?? 'new', () => options.onChanges?.())))
  // Otherwise an empty paragraph (an extra Enter) is saved as a `<br />` block.
  await crepe.editor.remove(remarkPreserveEmptyLinePlugin)

  crepe.on((listener) => {
    listener.markdownUpdated((_, updated) => options.onChange?.(updated))
  })
  await crepe.create()
  return crepe
}
