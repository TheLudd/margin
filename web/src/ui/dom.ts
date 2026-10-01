type Child = Node | string | null | undefined | false

// Creates an element: h('a', { href: '/x', class: 'link' }, 'text').
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) element.setAttribute(name, '')
    else if (typeof value === 'string') element.setAttribute(name, value)
  }
  for (const child of children) {
    if (child) element.append(child)
  }
  return element
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export const fileUrl = (path: string) => '/' + path.split('/').map(encodeURIComponent).join('/')

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export const dirName = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

// A link to a document that opens in place, but still works with middle
// click and "open in new tab".
export function fileLink(path: string, open: (path: string) => void, ...children: Child[]): HTMLAnchorElement {
  const link = h('a', { href: fileUrl(path), 'data-path': path }, ...children)
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    open(path)
  })
  return link
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
