// Mermaid, loaded only when a document has a mermaid block (D-08).

let loading: Promise<typeof import('mermaid').default> | null = null
let counter = 0

async function load() {
  if (!loading) {
    loading = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', fontFamily: 'system-ui, sans-serif' })
      return m.default
    })
  }
  return loading
}

/** Renders a diagram to SVG markup; throws with mermaid's message on bad input. */
export async function renderMermaid(source: string): Promise<string> {
  const mermaid = await load()
  const id = `margin-mermaid-${++counter}`
  const { svg } = await mermaid.render(id, source)
  return svg
}

export function mermaidLoaded(): boolean {
  return loading !== null
}
