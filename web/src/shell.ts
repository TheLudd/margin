// The page's skeleton: a mobile bar, the sidebar, the document column, the
// contents panel, a scrim for drawers and the dialogs (L-05, L-06).

export interface Shell {
  mobileBar: HTMLElement
  sidebar: HTMLElement
  main: HTMLElement
  toc: HTMLElement
  scrim: HTMLElement
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else node.setAttribute(k, v)
  }
  node.append(...children)
  return node
}

export { el }

export function buildShell(root: HTMLElement = document.body): Shell {
  const mobileBar = el(
    'header',
    { id: 'mobile-bar' },
    el('button', { id: 'open-sidebar', type: 'button', 'aria-label': 'Open the sidebar', text: '☰' }),
    el('span', { class: 'brand', text: 'margin' }),
    el('button', { id: 'open-toc', type: 'button', 'aria-label': 'Open the contents', text: '≡' }),
  )
  const sidebar = el('aside', { id: 'sidebar' })
  const main = el('main', { id: 'main', 'data-view': 'home' })
  const toc = el('nav', { id: 'toc', hidden: '' }, el('h2', { text: 'Contents' }), el('div', { class: 'links' }))
  const scrim = el('div', { id: 'scrim' })
  root.append(mobileBar, sidebar, main, toc, scrim)
  return { mobileBar, sidebar, main, toc, scrim }
}

export type Drawer = 'sidebar' | 'toc' | null

/** Opens or closes a drawer on narrow screens (L-06). */
export function setDrawer(drawer: Drawer): void {
  if (drawer) document.body.dataset.drawer = drawer
  else delete document.body.dataset.drawer
}

export function currentDrawer(): Drawer {
  return (document.body.dataset.drawer as Drawer) ?? null
}

const FOLD_KEY = 'margin.sidebar.folded'

/** Folds the sidebar to a strip on wide screens, or unfolds it (S-08, L-07). */
export function setSidebarFolded(folded: boolean): void {
  document.body.classList.toggle('sidebar-folded', folded)
  try {
    localStorage.setItem(FOLD_KEY, folded ? '1' : '0')
  } catch {
    // Storage may be unavailable; the fold still applies for this page.
  }
}

export function sidebarFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1'
  } catch {
    return false
  }
}
