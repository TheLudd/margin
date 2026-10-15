// The document view: loaded with the first document opened (T-07). Reading,
// editing, saving, the contents panel, the header and the banners.
import { api, ApiError } from './api'
import { createEditor, type EditorHandle } from './editor'
import { joinFrontmatter, splitFrontmatter, type Split } from './frontmatter'
import { buildHeader, setCommit, setCopies, setEditing as setHeaderEditing, setHeaderLabel, setManual, setStatus, type HeaderRefs } from './header'
import { isMarkdownLink, resolveMarkdownLink } from './links'
import { assemble, splitOriginal, type OriginalBlock } from './preserve'
import { navigate, plainClick, replaceHash } from './router'
import { TextSelection } from '@milkdown/kit/prose/state'
import { SaveError, Session, type Status } from './session'
import { el, type Shell } from './shell'
import { activeEntry, markActive, readEntries, renderToc, type TocEntry } from './toc'
import type { Doc, Lists, StreamEvent } from './types'
import { Review } from './review'
import './document.css'
import './changes.css'

export interface DocumentHost {
  onMissing(): void
  onOpened(): void
  lists(): Lists | null
  refreshLists(): Promise<void>
}

interface Open {
  path: string
  doc: Doc
  editor: EditorHandle
  session: Session
  review: Review
  split: Split
  originals: OriginalBlock[]
  source: string
  frontmatterText: string
}

let shell: Shell | null = null
let header: HeaderRefs | null = null
let banner: HTMLElement | null = null
let article: HTMLElement | null = null
let frontmatterPanel: HTMLDetailsElement | null = null
let frontmatterArea: HTMLTextAreaElement | null = null
let editorRoot: HTMLElement | null = null
let host: DocumentHost | null = null
let open: Open | null = null
let opening: Promise<void> | null = null
let entries: TocEntry[] = []

function ensure(s: Shell): void {
  if (header) return
  shell = s
  header = buildHeader()
  banner = el('div', { class: 'banner', hidden: '' })
  article = el('article')
  frontmatterPanel = el('details', { class: 'frontmatter', hidden: '' }, el('summary', { text: 'frontmatter' }))
  frontmatterArea = el('textarea', { spellcheck: 'false', 'aria-label': 'Frontmatter', readonly: '' })
  frontmatterPanel.append(frontmatterArea)
  editorRoot = el('div', { class: 'editor-host' })
  article.append(frontmatterPanel, editorRoot)
  s.main.prepend(header.root, banner, article)
  wireChrome()
}

function sizeFrontmatter(): void {
  if (!frontmatterArea) return
  frontmatterArea.style.height = 'auto'
  frontmatterArea.style.height = frontmatterArea.scrollHeight + 'px'
}

function wireChrome(): void {
  const h = header!
  h.badges.edit.addEventListener('click', () => setEditing(!open?.editor.editing))
  h.badges.manual.addEventListener('click', async () => {
    if (!open) return
    const on = !open.doc.manual
    await api.manual(open.path, on)
    open.doc.manual = on
    setManual(h, on)
    document.dispatchEvent(new CustomEvent('margin:manual', { detail: { on } }))
    host?.refreshLists()
  })
  h.badges.commit.addEventListener('click', () => void open?.review.toggleHead())
  h.markRead.addEventListener('click', () => void open?.review.markRead())
  h.count.addEventListener('click', () => open?.review.jumpTo(0))
  h.prev.addEventListener('click', () => open?.review.prev())
  h.next.addEventListener('click', () => open?.review.next())
  h.worktree.addEventListener('change', () => {
    if (h.worktree.value && h.worktree.value !== open?.path) navigate(h.worktree.value)
  })
  frontmatterPanel!.addEventListener('toggle', sizeFrontmatter)
  frontmatterArea!.addEventListener('input', () => {
    if (!open) return
    open.frontmatterText = frontmatterArea!.value
    sizeFrontmatter()
    open.session.edited()
  })
  document.addEventListener('keydown', onKey)
  shell!.main.addEventListener('scroll', () => updateActive(), { passive: true })
  shell!.toc.querySelector('.links')!.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement).closest('a')
    if (!a || !a.dataset.id) return
    ev.preventDefault()
    scrollToHeading(a.dataset.id)
  })
  editorRoot!.addEventListener('click', onLinkClick)
  window.addEventListener('focus', () => open?.session.revalidate())
  document.addEventListener('margin:visible', () => open?.session.revalidate())
  document.addEventListener('margin:reconnect', () => open?.session.revalidate())
  document.addEventListener('margin:event', (ev) => onStreamEvent((ev as CustomEvent<StreamEvent>).detail))
}

function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  if (!t) return false
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return true
  return false
}

function onKey(ev: KeyboardEvent): void {
  if (!open) return
  const finder = document.getElementById('finder') as HTMLDialogElement | null
  if (finder?.open) return
  if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
    ev.preventDefault()
    if (ev.key === 'ArrowUp') open.review.prev()
    else open.review.next()
    return
  }
  if (ev.key === 'Escape') {
    if (document.body.dataset.drawer) return
    if (open.editor.editing) {
      ev.preventDefault()
      setEditing(false)
    }
    return
  }
  if ((ev.key === 'e' || ev.key === 'E') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    if (isTyping(ev.target) || open.editor.editing) return
    ev.preventDefault()
    setEditing(true)
  }
}

/** Starts or stops editing (D-01, D-02). */
export function setEditing(on: boolean): void {
  if (!open || !header) return
  const { editor } = open
  if (editor.editing === on) return
  editor.setEditing(on)
  setHeaderEditing(header, on)
  document.body.classList.toggle('editing', on)
  if (frontmatterArea) frontmatterArea.readOnly = !on
  if (on) {
    const view = editor.view
    const sel = view.state.selection
    const hasSelection = view.hasFocus() || sel.from !== sel.to || (editor.lastClick !== null && document.activeElement?.closest('.ProseMirror') !== null)
    if (!hasSelection && editor.lastClick !== null) {
      const pos = Math.min(editor.lastClick, view.state.doc.content.size)
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
    }
    view.focus()
  } else {
    editor.view.dom.blur()
    void open.session.flush()
  }
}

function onLinkClick(ev: MouseEvent): void {
  const a = (ev.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
  if (!a || !open) return
  const href = a.getAttribute('href') ?? ''
  if (ev.ctrlKey || ev.metaKey) {
    if (isMarkdownLink(href)) {
      ev.preventDefault()
      const target = resolveMarkdownLink(href, open.path)
      const [p, hash] = target.split('#')
      navigate(p, hash ? '#' + hash : '')
      return
    }
  }
  if (open.editor.editing && plainClick(ev)) return
  ev.preventDefault()
  window.open(a.href, '_blank', 'noopener')
}

function onStreamEvent(ev: StreamEvent): void {
  if (!open) return
  if (ev.name === 'file' && ev.data.path === open.path) {
    if (ev.data.kind === 'removed') open.session.removed()
    else void open.session.external(ev.data.etag)
  }
  if (ev.name === 'head' && open.path.startsWith(ev.data.repo + '/')) {
    document.dispatchEvent(new CustomEvent('margin:head', { detail: ev.data }))
    void refreshMeta().then(() => open?.review.onHead())
  }
  if (ev.name === 'lists') void refreshMeta()
}

/** Refreshes what the header says about the file: git state, copies, flags. */
async function refreshMeta(): Promise<void> {
  if (!open || !header) return
  const o = open
  try {
    const meta = await api.meta(o.path)
    if (open !== o) return
    o.doc.git = meta.git
    o.doc.copies = meta.copies
    o.doc.manual = meta.manual
    o.doc.unread = meta.unread
    o.doc.hasCopy = meta.hasCopy
    setCommit(header, meta.git)
    setCopies(header, meta.copies, o.path)
    setManual(header, meta.manual)
    void o.review.onMeta(meta)
    document.dispatchEvent(new CustomEvent('margin:meta', { detail: meta }))
  } catch {
    // The file may be gone; the stream says so separately.
  }
}

/** The saved text: frontmatter reattached, untouched blocks byte for byte. */
function produce(o: Open): string {
  const doc = o.editor.view.state.doc
  const current: { norm: string }[] = []
  doc.forEach((node) => current.push({ norm: o.editor.serialize(node) }))
  const body = assemble(o.split.body, o.originals, current)
  return joinFrontmatter(o.split, o.frontmatterText, body)
}

function tools(editor: EditorHandle) {
  return {
    blocks: (source: string) => editor.blocks(source),
    norms: (markdown: string) => {
      const doc = editor.parse(markdown)
      const out: string[] = []
      doc.forEach((node) => out.push(editor.serialize(node)))
      return out
    },
  }
}

function showBanner(text: string, buttons: { label: string; action: () => void }[]): void {
  if (!banner) return
  banner.replaceChildren(el('span', { text }))
  for (const b of buttons) {
    const button = el('button', { type: 'button', text: b.label })
    button.addEventListener('click', b.action)
    banner.append(button)
  }
  banner.hidden = false
}

function hideBanner(): void {
  if (banner) banner.hidden = true
}

/** Replaces the document with a version read from disk (not an edit). */
function reloadFrom(o: Open, doc: Doc): void {
  o.doc = doc
  o.source = doc.content
  o.split = splitFrontmatter(doc.content)
  o.frontmatterText = o.split.text
  o.originals = splitOriginal(o.split.body, tools(o.editor))
  o.editor.replace(o.split.body)
  showFrontmatter(o)
  if (header) {
    setCommit(header, doc.git)
    setCopies(header, doc.copies, doc.path)
    setManual(header, doc.manual)
  }
  hideBanner()
  o.review.onReload()
  document.dispatchEvent(new CustomEvent('margin:reloaded', { detail: doc }))
}

function showFrontmatter(o: Open): void {
  if (!frontmatterPanel || !frontmatterArea) return
  frontmatterPanel.hidden = !o.split.raw
  frontmatterArea.value = o.frontmatterText
  frontmatterArea.readOnly = !o.editor.editing
  sizeFrontmatter()
}

/** After a save, the original blocks are what was saved. */
function rebase(o: Open, content: string): void {
  o.source = content
  o.split = splitFrontmatter(content)
  o.frontmatterText = o.split.text
  o.originals = splitOriginal(o.split.body, tools(o.editor))
}

export async function openDocument(s: Shell, path: string, h: DocumentHost): Promise<void> {
  ensure(s)
  host = h
  if (opening) await opening
  opening = (async () => {
    if (open) {
      if (open.path === path) return
      await closeDocument()
    }
    let doc: Doc | null
    try {
      doc = await api.file(path, undefined, true)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        h.onMissing()
        document.title = 'not found · margin'
        return
      }
      throw err
    }
    if (!doc) return
    const split = splitFrontmatter(doc.content)
    const events = {
      onEdit: (tr: import('@milkdown/kit/prose/state').Transaction) => {
        open?.session.edited()
        open?.review.onEdit(tr)
      },
      onTransaction: () => scheduleToc(),
    }
    editorRoot!.replaceChildren()
    const editor = await createEditor(editorRoot!, split.body, events)
    const o: Open = { path, doc, editor, split, originals: [], source: doc.content, frontmatterText: split.text, session: null as unknown as Session, review: null as unknown as Review }
    o.originals = splitOriginal(split.body, tools(editor))
    o.review = new Review({
      editor,
      header: header!,
      scroller: s.main,
      doc: () => o.doc,
      fetchBaseline: async (kind) => {
        const text = await api.baseline(path, kind).catch(() => null)
        return text === null ? null : splitFrontmatter(text).body
      },
      markRead: async () => {
        await api.markRead(path)
        o.doc.unread = false
        await host?.refreshLists()
      },
    })
    o.session = new Session(
      path,
      {
        save: async (p, content, etag) => {
          try {
            return await api.save(p, content, etag)
          } catch (err) {
            throw new SaveError(err instanceof ApiError ? err.status : 0)
          }
        },
        fetch: async (p, etag) => {
          try {
            return await api.file(p, etag)
          } catch (err) {
            throw new SaveError(err instanceof ApiError ? err.status : 0)
          }
        },
      },
      {
        onStatus: (status: Status) => {
          if (header) setStatus(header, status)
        },
        onReload: (fresh) => reloadFrom(o, fresh),
        onConflict: (theirs) => {
          showBanner('This file changed on disk while you were editing.', [
            { label: 'keep mine', action: () => void o.session.keepMine().then(() => hideBanner()) },
            { label: 'take theirs', action: () => void o.session.takeTheirs() },
          ])
          void theirs
        },
        onMissing: () => showBanner('This file was deleted or moved. Edits are not saved.', []),
        onSaved: (etag) => {
          o.doc.etag = etag
          rebase(o, produce(o))
          document.dispatchEvent(new CustomEvent('margin:saved', { detail: { etag } }))
          host?.refreshLists()
          void refreshMeta().then(() => o.review.onSaved())
        },
      },
      () => produce(o),
    )
    o.session.load(doc)
    open = o
    const singleRoot = (h.lists()?.roots.length ?? 1) === 1
    void singleRoot
    setHeaderLabel(header!, doc.name, doc.dir)
    setCopies(header!, doc.copies, doc.path)
    setCommit(header!, doc.git)
    setManual(header!, doc.manual)
    setHeaderEditing(header!, false)
    setStatus(header!, 'saved')
    document.body.classList.remove('editing')
    hideBanner()
    showFrontmatter(o)
    document.title = doc.name
    h.onOpened()
    rebuildToc()
    if (location.hash) scrollToHeading(decodeURIComponent(location.hash.slice(1)), false)
    else s.main.scrollTop = 0
    void o.review.start()
    void h.refreshLists()
    document.dispatchEvent(new CustomEvent('margin:opened', { detail: doc }))
  })()
  await opening
  opening = null
}

async function closeDocument(): Promise<void> {
  if (!open) return
  const o = open
  await o.session.flush()
  o.session.destroy()
  o.review.destroy()
  open = null
  document.body.classList.remove('editing')
  await o.editor.destroy()
  entries = []
  if (shell) shell.toc.hidden = true
}

/** Saves any pending edit before a reload or a switch (P-09, D-17). */
export async function flushPending(): Promise<void> {
  await open?.session.flush()
}

export function current(): { path: string; editor: EditorHandle; session: Session; doc: Doc } | null {
  return open ? { path: open.path, editor: open.editor, session: open.session, doc: open.doc } : null
}

export function headerRefs(): HeaderRefs | null {
  return header
}

let tocTimer: number | null = null
function scheduleToc(): void {
  if (tocTimer !== null) return
  tocTimer = window.requestAnimationFrame(() => {
    tocTimer = null
    rebuildToc()
  })
}

function rebuildToc(): void {
  if (!shell || !editorRoot) return
  entries = readEntries(editorRoot, shell.main)
  const links = shell.toc.querySelector('.links') as HTMLElement
  const active = activeEntry(entries, shell.main.scrollTop, shell.main.clientHeight, shell.main.scrollHeight)
  renderToc(links, entries, active)
  shell.toc.hidden = entries.length === 0
  if (active >= 0) markActive(links, active)
}

function updateActive(): void {
  if (!shell || entries.length === 0) return
  const links = shell.toc.querySelector('.links') as HTMLElement
  const active = activeEntry(entries, shell.main.scrollTop, shell.main.clientHeight, shell.main.scrollHeight)
  markActive(links, active)
}

function scrollToHeading(id: string, setHash = true): void {
  const heading = editorRoot?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
  if (!heading || !shell) return
  const top = heading.getBoundingClientRect().top - shell.main.getBoundingClientRect().top + shell.main.scrollTop - 60
  shell.main.scrollTo({ top: Math.max(0, top) })
  if (setHash) replaceHash(id)
  updateActive()
}
