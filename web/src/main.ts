// margin's frontend: the chrome loads here; the editor loads with the first
// document (T-07).
import './style.css'
import './sidebar.css'
import './settings.css'
import './finder.css'
import { api, ApiError } from './api'
import { hideBusy, showBusy } from './busy'
import { buildFinder, finderView, renderFinder, type FinderState } from './finder'
import { renderHome, renderMissing } from './pages'
import { currentRoute, navigate, onRoute, plainClick, startRouter, type Route } from './router'
import { renderSettings } from './settings'
import { buildShell, currentDrawer, el, setDrawer, setSidebarFolded, sidebarFolded } from './shell'
import { buildSidebar, localFolds, renderSidebar } from './sidebar'
import { Stream } from './stream'
import type { Config, Lists, StreamEvent } from './types'

const shell = buildShell()
const folds = localFolds()
const sidebar = buildSidebar(shell.sidebar, folds)
const sections = {
  home: el('section', { class: 'home' }),
  missing: el('section', { class: 'not-found' }),
  settings: el('section', { class: 'settings' }),
}
shell.main.append(sections.home, sections.missing, sections.settings)

let lists: Lists | null = null
let route: Route = currentRoute()
const currentPath = (): string | null => (route.kind === 'doc' ? route.path : null)

async function refreshLists(): Promise<void> {
  try {
    lists = await api.lists()
  } catch {
    return
  }
  renderSidebar(sidebar, { lists, current: currentPath() }, folds)
  document.body.classList.toggle('setup', lists.roots.length === 0)
  if (finder.dialog.open) drawFinder()
  if (route.kind === 'home' && lists.roots.length === 0) showSetup()
}

function setView(view: 'home' | 'settings' | 'missing' | 'document'): void {
  shell.main.dataset.view = view
}

async function showSetup(): Promise<void> {
  await showSettings(true)
}

let settingsToken = 0

async function showSettings(setup: boolean): Promise<void> {
  const token = ++settingsToken
  const view = await api.settings()
  if (token !== settingsToken) return
  setView('settings')
  document.title = setup ? 'margin' : 'settings · margin'
  const counts: Record<string, number> = {}
  if (lists) {
    const bump = (path: string) => {
      const root = path.replace(/^\//, '').split('/')[0] ?? ''
      counts[root] = (counts[root] ?? 0) + 1
    }
    for (const e of lists.recent) bump(e.path)
    for (const g of lists.older) for (const e of g.files) bump(e.path)
  }
  renderSettings(sections.settings, {
    view,
    counts,
    actions: {
      complete: (typed) => api.complete(typed).catch(() => []),
      loadSuggestions: () => api.suggest().catch(() => []),
      save: async (config: Config) => {
        const reindex = rootsChanged(view.config, config)
        if (reindex) showBusy('Re-indexing…')
        try {
          await api.saveSettings(config)
        } catch (err) {
          if (err instanceof ApiError) throw new Error(err.message)
          throw err
        } finally {
          hideBusy()
        }
        await refreshLists()
        if (setup) navigate('/')
        else await showSettings(false)
      },
    },
  })
}

function rootsChanged(a: Config, b: Config): boolean {
  return JSON.stringify([a.roots, a.exclude]) !== JSON.stringify([b.roots, b.exclude])
}

async function showDocument(path: string): Promise<void> {
  const { openDocument } = await import('./document')
  await openDocument(shell, path, {
    onMissing: () => {
      setView('missing')
      renderMissing(sections.missing, path)
    },
    onOpened: () => setView('document'),
    lists: () => lists,
    refreshLists,
  })
}

onRoute(async (r) => {
  route = r
  setDrawer(null)
  if (lists) renderSidebar(sidebar, { lists, current: currentPath() }, folds)
  switch (r.kind) {
    case 'home':
      document.title = 'margin'
      if (lists && lists.roots.length === 0) await showSetup()
      else {
        setView('home')
        renderHome(sections.home)
      }
      break
    case 'settings':
      await showSettings(false)
      break
    case 'doc':
      await showDocument(r.path)
      break
  }
})

// Sidebar links are real links; a plain click opens in place (S-11).
document.addEventListener('click', (ev) => {
  const target = ev.target as HTMLElement
  const forget = target.closest('button.forget') as HTMLButtonElement | null
  if (forget?.dataset.path) {
    ev.preventDefault()
    api.dismiss(forget.dataset.path).then(refreshLists)
    return
  }
  const a = target.closest('a') as HTMLAnchorElement | null
  if (!a || !plainClick(ev)) return
  if (a.origin !== location.origin || a.target === '_blank') return
  if (!shell.sidebar.contains(a) && !shell.main.contains(a) && !shell.mobileBar.contains(a)) return
  if (a.closest('.ProseMirror')) return
  ev.preventDefault()
  navigate(a.pathname + a.search, a.hash)
})

// The finder (S-09): Ctrl K or Ctrl P, or the search field, opens it.
const finder = buildFinder()
const finderState: FinderState = { query: '', older: false, selected: 0 }

function finderRows() {
  return lists ? finderView(lists, finderState) : null
}

function drawFinder(): void {
  const view = finderRows()
  if (!view) return
  if (finderState.selected >= view.rows.length) finderState.selected = Math.max(0, view.rows.length - 1)
  renderFinder(finder, view, finderState)
}

function openFinder(): void {
  if (finder.dialog.open) return
  finderState.query = ''
  finderState.older = false
  finderState.selected = 0
  finder.input.value = ''
  drawFinder()
  finder.dialog.showModal()
  finder.input.focus()
}

function closeFinder(): void {
  if (finder.dialog.open) finder.dialog.close()
}

finder.input.addEventListener('input', () => {
  finderState.query = finder.input.value
  finderState.selected = 0
  drawFinder()
})

finder.input.addEventListener('keydown', (ev) => {
  const view = finderRows()
  if (!view) return
  switch (ev.key) {
    case 'ArrowDown':
      ev.preventDefault()
      finderState.selected = Math.min(view.rows.length - 1, finderState.selected + 1)
      drawFinder()
      break
    case 'ArrowUp':
      ev.preventDefault()
      finderState.selected = Math.max(0, finderState.selected - 1)
      drawFinder()
      break
    case 'Tab':
      ev.preventDefault()
      finderState.older = !finderState.older
      drawFinder()
      break
    case 'Enter': {
      ev.preventDefault()
      const row = view.rows[finderState.selected]
      if (row) {
        closeFinder()
        navigate(row.entry.path)
      }
      break
    }
  }
})

finder.dialog.addEventListener('click', (ev) => {
  const target = ev.target as HTMLElement
  if (target === finder.dialog) {
    closeFinder()
    return
  }
  if (target.closest('li.toggle')) {
    finderState.older = !finderState.older
    drawFinder()
    finder.input.focus()
    return
  }
  const a = target.closest('a') as HTMLAnchorElement | null
  if (a && plainClick(ev)) {
    ev.preventDefault()
    closeFinder()
    navigate(a.pathname)
  }
})

sidebar.findButton.addEventListener('click', openFinder)
document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'p')) {
    ev.preventDefault()
    openFinder()
  }
})

sidebar.closeButton.addEventListener('click', () => setSidebarFolded(true))
sidebar.unfoldButton.addEventListener('click', () => setSidebarFolded(false))
if (sidebarFolded()) setSidebarFolded(true)

shell.mobileBar.querySelector('#open-sidebar')!.addEventListener('click', () => setDrawer('sidebar'))
shell.mobileBar.querySelector('#open-toc')!.addEventListener('click', () => setDrawer('toc'))
shell.scrim.addEventListener('click', () => setDrawer(null))
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && currentDrawer()) {
    setDrawer(null)
    ev.stopPropagation()
  }
})

// The sidebar lists refresh on every event, on reconnect and when the tab
// becomes visible, never on a timer (S-06).
const stream = new Stream({
  onEvent: (ev: StreamEvent) => {
    refreshLists()
    if (ev.name === 'config' && route.kind === 'settings') showSettings(false)
    document.dispatchEvent(new CustomEvent('margin:event', { detail: ev }))
  },
  onReconnect: () => {
    refreshLists()
    document.dispatchEvent(new CustomEvent('margin:reconnect'))
  },
  onNewBuild: async () => {
    document.dispatchEvent(new CustomEvent('margin:newbuild'))
    const { flushPending } = await import('./document')
    await flushPending()
    location.reload()
  },
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshLists()
    document.dispatchEvent(new CustomEvent('margin:visible'))
  }
})

refreshLists().then(() => {
  startRouter()
  stream.connect()
})
