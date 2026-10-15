// Where the page is: home, settings or a document (F-03, C-08).

export type Route = { kind: 'home' } | { kind: 'settings' } | { kind: 'doc'; path: string }

export function parseRoute(pathname: string): Route {
  const path = decodeURIComponent(pathname)
  if (path === '/' || path === '') return { kind: 'home' }
  if (path === '/settings') return { kind: 'settings' }
  if (path.split('/').length >= 3) return { kind: 'doc', path }
  return { kind: 'home' }
}

type Listener = (route: Route) => void

const listeners: Listener[] = []

export function onRoute(fn: Listener): void {
  listeners.push(fn)
}

export function currentRoute(): Route {
  return parseRoute(location.pathname)
}

/** Navigates in place, keeping history. */
export function navigate(path: string, hash = ''): void {
  const target = path + hash
  if (location.pathname + location.hash === target) return
  history.pushState(null, '', target)
  emit()
}

export function replaceHash(hash: string): void {
  history.replaceState(null, '', location.pathname + (hash ? '#' + hash : ''))
}

function emit(): void {
  const route = currentRoute()
  for (const fn of listeners) fn(route)
}

export function startRouter(): void {
  window.addEventListener('popstate', emit)
  emit()
}

/** Whether a link click should navigate in place: a plain left click. */
export function plainClick(ev: MouseEvent): boolean {
  return ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey
}
