import type { RenderPreview } from './editor'

let rendered = 0
let ready: Promise<typeof import('mermaid').default> | undefined

// Mermaid is large, so it is only loaded once a document contains a diagram.
function loadMermaid() {
  ready ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        darkMode: true,
        background: '#07081a',
        primaryColor: '#171a3a',
        primaryBorderColor: '#00e5ff',
        primaryTextColor: '#d6dbff',
        secondaryColor: '#10122a',
        tertiaryColor: '#10122a',
        lineColor: '#ff2bd6',
        textColor: '#d6dbff',
        fontFamily: 'Source Code Pro, monospace',
      },
    })
    return mermaid
  })
  return ready
}

// Renders ```mermaid blocks as diagrams; other code blocks get no preview.
export const renderMermaid: RenderPreview = (language, content, apply) => {
  if (language.toLowerCase() !== 'mermaid') return null
  loadMermaid()
    .then((mermaid) => mermaid.render(`mermaid-${++rendered}`, content))
    .then(({ svg }) => apply(svg))
    .catch((error: Error) => {
      const message = document.createElement('pre')
      message.className = 'mermaid-error'
      message.textContent = error.message
      apply(message)
    })
}
