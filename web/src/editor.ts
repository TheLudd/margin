// The editor (D): Milkdown kit without Crepe, with the rewrite's own code
// block view, task checkboxes, table wrapper and cursor-block highlight.
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, remarkCtx, remarkStringifyOptionsCtx, rootCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark, codeBlockSchema, listItemSchema } from '@milkdown/kit/preset/commonmark'
import { gfm, tableSchema } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { $prose, $view } from '@milkdown/kit/utils'
import type { Node as PMNode, Schema } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from '@milkdown/kit/prose/view'
import { changesPlugin } from './marks'
import { renderMermaid } from './mermaid'
import { normalizeLabel, type BlockInfo } from './preserve'

export interface EditorHandle {
  editor: Editor
  view: EditorView
  schema: Schema
  /** Whether the document is editable right now. */
  editing: boolean
  setEditing(on: boolean): void
  /** The current document, serialized as markdown. */
  markdown(): string
  /** Parses markdown into a document node. */
  parse(markdown: string): PMNode
  /** Serializes one node (a block, or a doc) to markdown without the trailing newline. */
  serialize(node: PMNode): string
  /** The top-level blocks of a markdown source, with positions. */
  blocks(markdown: string): BlockInfo[]
  /** Replaces the document from outside (a reload): not an edit. */
  replace(markdown: string): void
  /** The last click position in the document, for starting to edit there. */
  lastClick: number | null
  destroy(): Promise<void>
}

export interface EditorEvents {
  /** A transaction changed the document through the reader's doing. */
  onEdit(tr: Transaction): void
  /** Any transaction was applied; the DOM is up to date. */
  onTransaction(tr: Transaction): void
}

export const externalMeta = 'margin-external'

/** Marks a transaction as coming from outside, not from the reader. */
export function external(tr: Transaction): Transaction {
  return tr.setMeta(externalMeta, true).setMeta('addToHistory', false)
}

/**
 * Whether a transaction is the reader's doing (D-03): it changes the
 * document, comes from inside, and is not housekeeping, which plugins mark
 * by keeping it out of the history (heading ids, list numbering).
 */
export function isEdit(tr: Transaction): boolean {
  return tr.docChanged && !tr.getMeta(externalMeta) && tr.getMeta('addToHistory') !== false
}

/* The block holding the cursor, highlighted while editing (D-02). */
const cursorBlockKey = new PluginKey('margin-cursor-block')
const cursorBlock = $prose(
  () =>
    new Plugin({
      key: cursorBlockKey,
      props: {
        decorations(state) {
          const view = currentView
          if (!view || !view.editable) return null
          const $head = state.selection.$head
          if ($head.depth === 0) return null
          const pos = $head.before(1)
          const node = state.doc.nodeAt(pos)
          if (!node) return null
          return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'cursor-block' })])
        },
      },
    }),
)
let currentView: EditorView | null = null

const changesProse = $prose(() => changesPlugin())

/* Code blocks (D-08, D-09): a pre the editor types into; mermaid renders
   its diagram and shows the source with a live preview on a click. */
class CodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private preview: HTMLElement
  private pre: HTMLElement
  private rendered = ''
  private timer: number | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'code-block'
    this.pre = document.createElement('pre')
    const code = document.createElement('code')
    this.pre.append(code)
    this.contentDOM = code
    this.preview = document.createElement('div')
    this.preview.className = 'preview'
    this.preview.contentEditable = 'false'
    this.dom.append(this.pre, this.preview)
    this.preview.addEventListener('click', () => {
      if (!this.view.editable) return
      this.dom.classList.add('source-open')
      this.view.focus()
    })
    this.apply()
  }

  private language(): string {
    return (this.node.attrs.language as string) || ''
  }

  private apply(): void {
    const lang = this.language()
    this.dom.dataset.language = lang
    this.pre.dataset.language = lang
    const mermaid = lang === 'mermaid'
    this.dom.classList.toggle('mermaid', mermaid)
    if (mermaid) this.scheduleRender()
    else {
      this.preview.replaceChildren()
      this.rendered = ''
    }
  }

  private scheduleRender(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.render()
    }, this.rendered ? 300 : 0)
  }

  private async render(): Promise<void> {
    const source = this.node.textContent
    if (source === this.rendered) return
    this.rendered = source
    try {
      const svg = await renderMermaid(source)
      if (this.rendered !== source) return
      this.preview.innerHTML = svg
      this.preview.classList.remove('failed')
    } catch (err) {
      if (this.rendered !== source) return
      const pre = document.createElement('pre')
      pre.className = 'mermaid-error'
      pre.textContent = err instanceof Error ? err.message : String(err)
      this.preview.replaceChildren(pre)
      this.preview.classList.add('failed')
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.apply()
    return true
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(m.target) && m.target !== this.contentDOM
  }

  stopEvent(ev: Event): boolean {
    return this.preview.contains(ev.target as Node)
  }

  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer)
  }
}

/* Task items (D-07): a checkbox whose click is an edit. */
class ListItemView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private checkbox: HTMLInputElement | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('li')
    if (node.attrs.checked == null) {
      this.contentDOM = this.dom
    } else {
      this.dom.dataset.itemType = 'task'
      this.checkbox = document.createElement('input')
      this.checkbox.type = 'checkbox'
      this.checkbox.contentEditable = 'false'
      this.checkbox.addEventListener('change', () => this.toggle())
      const content = document.createElement('div')
      content.className = 'task-content'
      this.dom.append(this.checkbox, content)
      this.contentDOM = content
    }
    this.apply()
  }

  private apply(): void {
    const attrs = this.node.attrs
    this.dom.dataset.label = attrs.label
    this.dom.dataset.listType = attrs.listType
    this.dom.dataset.spread = String(attrs.spread)
    if (this.checkbox) {
      this.dom.dataset.checked = String(attrs.checked)
      this.checkbox.checked = !!attrs.checked
    }
  }

  private toggle(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked: !this.node.attrs.checked })
    this.view.dispatch(tr)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    if ((node.attrs.checked == null) !== (this.node.attrs.checked == null)) return false
    this.node = node
    this.apply()
    return true
  }

  stopEvent(ev: Event): boolean {
    return this.checkbox !== null && ev.target === this.checkbox
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    return this.checkbox !== null && (m.target === this.checkbox || m.target === this.dom)
  }
}

/* Tables (D-11, J-07): a wrapper that scrolls when the table is wider. */
class TableView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  constructor() {
    this.dom = document.createElement('div')
    this.dom.className = 'table-block'
    const wrapper = document.createElement('div')
    wrapper.className = 'table-wrapper'
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.append(tbody)
    wrapper.append(table)
    this.dom.append(wrapper)
    this.contentDOM = tbody
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(m.target) && m.target !== this.contentDOM
  }
}

const views = [
  $view(codeBlockSchema.node, () => (node, view) => new CodeBlockView(node, view)),
  $view(listItemSchema.node, () => (node, view, getPos) => new ListItemView(node, view, getPos)),
  $view(tableSchema.node, () => () => new TableView()),
]

/** Creates an editor in root with markdown, read-only until setEditing(true). */
export async function createEditor(root: HTMLElement, markdown: string, events: EditorEvents): Promise<EditorHandle> {
  let editing = false
  const handle = { editing: false, lastClick: null as number | null } as EditorHandle
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
      // The most common markdown spelling for what the editor writes fresh.
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const, listItemIndent: 'one' as const, fences: true, rule: '-' as const, ruleSpaces: false }))
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => editing,
        dispatchTransaction(this: EditorView, tr: Transaction) {
          const state = this.state.apply(tr)
          this.updateState(state)
          if (isEdit(tr)) events.onEdit(tr)
          events.onTransaction(tr)
        },
        handleDOMEvents: {
          mousedown(view, ev) {
            const pos = view.posAtCoords({ left: ev.clientX, top: ev.clientY })
            handle.lastClick = pos ? pos.pos : null
            return false
          },
        },
      }))
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(cursor)
    .use(cursorBlock)
    .use(changesProse)
    .use(views)
  await editor.create()
  const view = editor.ctx.get(editorViewCtx)
  currentView = view
  const schema = editor.ctx.get(schemaCtx)
  const parser = editor.ctx.get(parserCtx)
  const serializer = editor.ctx.get(serializerCtx)
  const remark = editor.ctx.get(remarkCtx)

  Object.assign(handle, {
    editor,
    view,
    schema,
    setEditing(on: boolean) {
      editing = on
      handle.editing = on
      view.setProps({ editable: () => editing })
      view.dispatch(external(view.state.tr))
    },
    markdown: () => serializer(view.state.doc),
    parse: (md: string) => parser(md),
    serialize(node: PMNode) {
      const doc = node.type === schema.topNodeType ? node : schema.topNodeType.create(null, [node])
      return serializer(doc).replace(/\n+$/, '')
    },
    blocks(md: string) {
      const tree = remark.parse(md) as { children: { type: string; identifier?: string; label?: string; position: { start: { offset: number }; end: { offset: number } } }[] }
      return tree.children
        .filter((c) => c.position)
        .map((c) => {
          const definition = c.type === 'definition' || c.type === 'footnoteDefinition'
          const identifier = definition ? (c.type === 'footnoteDefinition' ? '^' : '') + normalizeLabel(c.label ?? c.identifier ?? '') : undefined
          return { position: c.position, definition, identifier }
        })
    },
    replace(md: string) {
      const doc = parser(md)
      const { from } = view.state.selection
      let tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
      const pos = Math.min(from, tr.doc.content.size)
      try {
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
      } catch {
        // Keep the default selection.
      }
      view.dispatch(external(tr))
    },
    async destroy() {
      if (currentView === view) currentView = null
      await editor.destroy()
    },
  })
  return handle
}
