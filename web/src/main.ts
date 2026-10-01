import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import './style.css'

import { type FileEntry, fetchRecent, fetchTree, markViewed, readFile, type Recent, writeFile } from './api'
import { DocumentSession } from './document/session'
import { createEditor, type Editor } from './editor/editor'
import { renderMermaid } from './editor/mermaid'
import { connect, debounce } from './sync'
import { byId, fileUrl } from './ui/dom'
import { DocumentView } from './ui/document-view'
import { Finder } from './ui/finder'
import { Sidebar } from './ui/sidebar'
import { Toc } from './ui/toc'

const pollInterval = 15_000

let files: FileEntry[] = []
let recent: Recent = { viewed: [], modified: [] }
let session: DocumentSession | undefined
let editor: Editor | undefined
let opening = 0

const main = byId('main')
const sidebar = new Sidebar(byId('sidebar'), (path) => open(path))
const view = new DocumentView(main, (value) => session?.editFrontmatter(value))
const toc = new Toc(byId('toc'), view.editorEl, main)
new Finder(
  () => files.map((f) => f.path),
  () => recent.viewed,
  (path) => open(path),
)

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
  view.editorEl.replaceChildren()
  if (push) history.pushState(null, '', fileUrl(path))
  sidebar.setCurrent(path)

  if (result.kind !== 'doc') {
    main.dataset.view = 'missing'
    return
  }
  main.dataset.view = 'document'

  const current: DocumentSession = new DocumentSession(path, result.doc, remote, {
    state: (state) => view.state(state, current),
    frontmatter: (value) => view.frontmatter(value),
  })
  view.show(path, current.initialFrontmatter)
  const created = await createEditor(view.editorEl, current.body, {
    onChange: () => current.edited(),
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

  await markViewed(path)
  refreshRecent()
}

function showHome() {
  ++opening
  session?.flush()
  session?.dispose()
  editor?.destroy()
  session = undefined
  editor = undefined
  view.editorEl.replaceChildren()
  main.dataset.view = 'home'
  document.title = 'margin'
  sidebar.setCurrent(undefined)
  toc.build()
}

function route() {
  const path = decodeURIComponent(location.pathname.slice(1))
  if (path === '') showHome()
  else open(path, false)
}

const refreshTree = debounce(async () => {
  files = await fetchTree()
  sidebar.renderTree(files)
}, 300)

const refreshRecent = debounce(async () => {
  recent = await fetchRecent()
  sidebar.renderRecent(recent)
}, 300)

const revalidate = debounce(() => session?.revalidate(), 50)

// Never stale: changes are pushed, and the document is also revalidated on
// every reconnect, whenever the tab comes back, and periodically.
connect({
  connected() {
    revalidate()
    refreshTree()
    refreshRecent()
  },
  event(event) {
    if (event.path === session?.path) revalidate()
    if (event.kind !== 'changed') refreshTree()
    refreshRecent()
  },
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') revalidate()
})
window.addEventListener('focus', () => revalidate())
setInterval(() => {
  if (document.visibilityState === 'visible') revalidate()
}, pollInterval)

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

route()
