// Syntax highlighting (D-18): code blocks with a known language get their
// tokens coloured, in reading and while editing.
import { common, createLowlight } from 'lowlight'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

const lowlight = createLowlight(common)

/** A run of code with the highlighter's classes, by offset in the source. */
export interface Token {
  from: number
  to: number
  className: string
}

interface HastNode {
  type: string
  value?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

/** The coloured runs of code in language; none when the language is unknown. */
export function tokenize(code: string, language: string): Token[] {
  if (!language || !lowlight.registered(language)) return []
  const tokens: Token[] = []
  let offset = 0
  const walk = (node: HastNode, classes: string[]): void => {
    if (node.type === 'text') {
      const end = offset + (node.value ?? '').length
      if (classes.length && end > offset) tokens.push({ from: offset, to: end, className: classes.join(' ') })
      offset = end
      return
    }
    const own = node.properties?.className ?? []
    for (const child of node.children ?? []) walk(child, [...classes, ...own])
  }
  walk(lowlight.highlight(language, code) as HastNode, [])
  return tokens
}

/* Code blocks are immutable nodes: an unchanged block keeps its tokens. */
const cache = new WeakMap<PMNode, Token[]>()

function blockTokens(node: PMNode): Token[] {
  let tokens = cache.get(node)
  if (!tokens) {
    tokens = tokenize(node.textContent, (node.attrs.language as string) || '')
    cache.set(node, tokens)
  }
  return tokens
}

function decorations(doc: PMNode): DecorationSet {
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true
    for (const t of blockTokens(node)) found.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.className }))
    return false
  })
  return DecorationSet.create(doc, found)
}

const key = new PluginKey<DecorationSet>('margin-highlight')

export function highlightPlugin(): Plugin<DecorationSet> {
  return new Plugin({
    key,
    state: {
      init: (_, state) => decorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? decorations(tr.doc) : set),
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  })
}
