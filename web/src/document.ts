// The document view: loaded with the first document opened. The editor
// arrives in section 6; until then the header and the file's text.
import { api, ApiError } from './api'
import { fileLabel, splitPath } from './format'
import { el, type Shell } from './shell'
import type { Lists } from './types'

export interface DocumentHost {
  onMissing(): void
  onOpened(): void
  lists(): Lists | null
  refreshLists(): Promise<void>
}

let header: HTMLElement | null = null
let article: HTMLElement | null = null

function ensure(shell: Shell): void {
  if (header && article) return
  header = el('header', { class: 'doc-header' }, el('div', { class: 'path' }), el('div', { class: 'badges' }))
  article = el('article')
  shell.main.prepend(header, article)
}

export async function openDocument(shell: Shell, path: string, host: DocumentHost): Promise<void> {
  ensure(shell)
  let doc
  try {
    doc = await api.file(path)
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      host.onMissing()
      document.title = 'not found · margin'
      return
    }
    throw err
  }
  if (!doc) return
  const singleRoot = (host.lists()?.roots.length ?? 1) === 1
  const { name, dir } = splitPath(doc.path, singleRoot)
  header!.querySelector('.path')!.replaceChildren(fileLabel(name, dir))
  document.title = name
  article!.replaceChildren(el('pre', { text: doc.content }))
  host.onOpened()
  api.open(path).then(() => host.refreshLists())
}

/** Saves any pending edit before a reload (P-09, D-17). */
export async function flushPending(): Promise<void> {}
