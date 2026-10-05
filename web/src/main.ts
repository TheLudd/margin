import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import './style.css'

import {
  type Activity,
  fetchRecent,
  fetchSettings,
  fetchTree,
  fetchUnread,
  forgetRecent,
  markSeen,
  markViewed,
  readCommitted,
  readFile,
  readSeen,
  type Settings,
  writeFile,
} from './api'
import { Comparison } from './document/comparison'
import { DocumentSession } from './document/session'
import { createEditor, type Editor } from './editor/editor'
import { renderMermaid } from './editor/mermaid'
import { connect, debounce } from './sync'
import { ChangesView } from './ui/changes-view'
import { groupCopies, isActive, type LogicalFile } from './ui/copies'
import { display, setRoots } from './ui/display'
import { byId, fileUrl } from './ui/dom'
import { DocumentView } from './ui/document-view'
import { Finder } from './ui/finder'
import { SettingsView } from './ui/settings-view'
import { Sidebar } from './ui/sidebar'
import { Toc } from './ui/toc'

let settings: Settings = { file: '', roots: [], exclude: [], activeDays: 14, unreadDays: 30 }
let files: LogicalFile[] = []
let recent: Activity[] = []
let session: DocumentSession | undefined
let editor: Editor | undefined
let comparison: Comparison | undefined
let opening = 0

const main = byId('main')
const sidebar = new Sidebar(
  byId('sidebar'),
  (path) => open(path),
  async (path) => {
    await forgetRecent(path)
    refreshRecent()
    refreshTree() // the file may no longer be active
  },
)
const changes = new ChangesView(main, {
  use: (baseline) => comparison?.use(baseline),
  markRead,
  focus: (focus) => editor?.focusChange(focus),
})
const view = new DocumentView(
  main,
  (value) => session?.editFrontmatter(value),
  (path) => open(path),
  changes.el,
  changes.commitEl,
)
const toc = new Toc(byId('toc'), view.editorEl, main)
const settingsView = new SettingsView(main, (saved) => {
  applySettings(saved)
  navigate('/')
})
const finderItem = (f: LogicalFile) => ({ label: display(`${f.project}/${f.rel}`), path: f.preferred.path })
new Finder(
  () => files.filter((f) => isActive(f, settings.activeDays)).map(finderItem),
  () => files.filter((f) => !isActive(f, settings.activeDays)).map(finderItem),
  () => recent.map((a) => ({ label: display(a.path), path: a.path })),
  (path) => open(path),
)

const copiesOf = (path: string) => files.find((f) => f.copies.some((c) => c.path === path))

const remote = { read: readFile, write: writeFile }

async function open(path: string, push = true) {
  if (session?.path === path) return
  const token = ++opening

  await session?.flush()
  const result = await readFile(path)
  if (token !== opening) return

  session?.dispose()
  await editor?.destroy()
  editor = undefined
  session = undefined
  comparison = undefined
  view.editorEl.replaceChildren()
  if (push) history.pushState(null, '', fileUrl(path))
  sidebar.setCurrent(path)

  if (result.kind !== 'doc') {
    main.dataset.view = 'missing'
    return
  }
  main.dataset.view = 'document'

  const current: DocumentSession = new DocumentSession(path, result.doc, remote, {
    state: (state) => {
      view.state(state, current)
      // Saved or reloaded: the baselines may have moved.
      if (state === 'clean' && session === current) {
        comparison?.load(current.version.content)
        refreshUnread()
      }
    },
    frontmatter: (value) => view.frontmatter(value),
  })
  view.show(path, current.initialFrontmatter)
  view.copies(copiesOf(path), path)
  const created = await createEditor(view.editorEl, current.body, {
    onChange: () => current.edited(),
    onChanges: () => changes.update(),
    renderPreview: renderMermaid,
  })
  if (token !== opening) {
    await created.destroy()
    return
  }
  session = current
  editor = created
  session.attach(editor)
  main.scrollTop = 0
  toc.build()
  changes.reset()
  compare(current, created)

  await markViewed(path)
  refreshRecent()
  refreshTree() // the file is now active
}

// Shows the changes in the open document against the chosen baseline.
function compare(current: DocumentSession, shown: Editor) {
  const live = () => editor === shown
  const comparing: Comparison = new Comparison(
    current.path,
    { seen: readSeen, committed: readCommitted },
    {
      compare: (body) => live() && shown.compare(body),
      state: (baseline, committed) => live() && changes.state(baseline, committed),
    },
  )
  comparison = comparing
  comparing.load(current.version.content)
}

// Records the version on screen as read, which clears its unread changes.
async function markRead() {
  const current = session
  const comparing = comparison
  if (!current || !comparing) return
  await current.flush()
  if (!(await markSeen(current.path, current.version.etag))) await current.revalidate()
  comparing.load(current.version.content)
  refreshUnread()
}

// Shows a page that isn't a document: home, setup or settings.
function showPage(page: string, title: string) {
  ++opening
  session?.flush()
  session?.dispose()
  editor?.destroy()
  session = undefined
  editor = undefined
  comparison = undefined
  view.editorEl.replaceChildren()
  main.dataset.view = page
  document.title = title
  sidebar.setCurrent(undefined)
  toc.build()
}

function route() {
  const path = decodeURIComponent(location.pathname.slice(1))
  if (path === 'settings') {
    showPage('settings', 'Settings · margin')
    settingsView.show('settings', settings)
  } else if (settings.roots.length === 0) {
    showPage('settings', 'Welcome · margin')
    settingsView.show('setup', settings)
  } else if (path === '') {
    showPage('home', 'margin')
  } else {
    open(path, false)
  }
}

function navigate(path: string) {
  history.pushState(null, '', path)
  route()
}

// Uses new settings. Gaining the first folder or losing the last one
// switches between setup and the app, so the page is routed again.
function applySettings(next: Settings, reroute = true) {
  const hadRoots = settings.roots.length > 0
  settings = next
  setRoots(settings.roots.map((r) => r.name))
  document.body.classList.toggle('setup', settings.roots.length === 0)
  if (reroute && hadRoots !== settings.roots.length > 0) route()
  refreshTree()
  refreshRecent()
}

const refreshSettings = debounce(async () => applySettings(await fetchSettings()), 300)

const refreshTree = debounce(async () => {
  files = groupCopies(await fetchTree())
  sidebar.renderTree(files)
  if (session) view.copies(copiesOf(session.path), session.path)
}, 300)

const refreshRecent = debounce(async () => {
  recent = await fetchRecent()
  sidebar.renderRecent(recent, settings.activeDays)
}, 300)

const refreshUnread = debounce(async () => sidebar.setUnread(new Set(await fetchUnread())), 300)

// Commits don't touch the file, so the baselines are refetched as well.
const revalidate = debounce(() => {
  session?.revalidate()
  if (session) comparison?.load(session.version.content)
}, 50)

// Never stale: changes and commits are pushed, and the document is also
// revalidated on every reconnect and whenever the tab comes back.
connect({
  connected() {
    revalidate()
    refreshTree()
    refreshRecent()
    refreshUnread()
  },
  event(event) {
    const inRepo = event.kind === 'head' && session?.path.startsWith(`${event.path}/`)
    if (event.path === session?.path || inRepo) revalidate()
    if (event.kind === 'tree') refreshSettings() // roots may have changed
    if (event.kind !== 'changed') refreshTree()
    refreshRecent()
    refreshUnread()
  },
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') revalidate()
})
window.addEventListener('focus', () => revalidate())

// The active window moves with time, not only with changes.
setInterval(refreshRecent, 10 * 60_000)

window.addEventListener('popstate', route)
window.addEventListener('beforeunload', (event) => {
  if (session?.dirty) {
    session.flush()
    event.preventDefault()
  }
})

// Ctrl/Cmd-click on a link to another markdown file opens it here.
view.editorEl.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest('a')
  if (!link || !(event.ctrlKey || event.metaKey) || !session) return
  event.preventDefault()
  const href = link.getAttribute('href') ?? ''
  const target = new URL(href, location.origin + fileUrl(session.path))
  if (target.origin === location.origin && target.pathname.toLowerCase().endsWith('.md')) {
    open(decodeURIComponent(target.pathname.slice(1)))
  } else {
    window.open(target.href, '_blank', 'noopener')
  }
})

byId('settings-link').addEventListener('click', (event) => {
  event.preventDefault()
  navigate('/settings')
})

fetchSettings().then((loaded) => {
  applySettings(loaded, false)
  route()
})
