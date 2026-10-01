// One open document: keeps the editor and the file on disk in sync.
//
// - Edits autosave after a pause. Only real edits save; viewing never writes.
// - Saves keep the original text of untouched blocks (see preserveSource).
// - `revalidate` pulls in changes made on disk. Local edits are never
//   overwritten silently: the session enters `conflict` instead.

import type { Doc, ReadResult, WriteResult } from '../api'
import { joinFrontmatter, type Split, splitFrontmatter } from '../markdown/frontmatter'
import { preserveSource } from '../markdown/preserve-source'

export interface Remote {
  read(path: string, etag?: string): Promise<ReadResult>
  write(path: string, content: string, etag: string): Promise<WriteResult>
}

// The editor, as far as the session is concerned.
export interface Surface {
  markdown(): string
  replace(body: string): void
}

export type State = 'clean' | 'dirty' | 'saving' | 'conflict' | 'missing' | 'error'

export interface Listener {
  state(state: State): void
  frontmatter(frontmatter: string): void
}

const retryDelay = 5000

export class DocumentSession {
  private etag: string
  private disk: Split // the file as last read or written
  private frontmatter: string
  private baseline = '' // what the editor serializes disk.body to
  private surface?: Surface
  private timer?: ReturnType<typeof setTimeout>
  private saving?: Promise<void>
  private reading?: Promise<void>
  private revalidateAfterSave = false
  private theirs?: Doc // a disk version not applied because of local edits

  constructor(
    readonly path: string,
    doc: Doc,
    private readonly remote: Remote,
    private readonly listener: Listener,
    private readonly delay = 800,
  ) {
    this.etag = doc.etag
    this.disk = splitFrontmatter(doc.content)
    this.frontmatter = this.disk.frontmatter
  }

  // The markdown to load into the editor.
  get body(): string {
    return this.disk.body
  }

  get initialFrontmatter(): string {
    return this.disk.frontmatter
  }

  attach(surface: Surface) {
    this.surface = surface
    this.baseline = surface.markdown()
  }

  get dirty(): boolean {
    return this.frontmatter !== this.disk.frontmatter || (!!this.surface && this.surface.markdown() !== this.baseline)
  }

  edited() {
    this.schedule()
  }

  editFrontmatter(frontmatter: string) {
    this.frontmatter = frontmatter
    this.schedule()
  }

  async save(): Promise<void> {
    clearTimeout(this.timer)
    if (this.saving) await this.saving
    if (!this.surface || !this.dirty || this.theirs) return

    const markdown = this.surface.markdown()
    const next = { frontmatter: this.frontmatter, body: preserveSource(this.disk.body, markdown) }
    this.listener.state('saving')
    this.saving = this.write(next, markdown).finally(() => (this.saving = undefined))
    await this.saving

    if (this.revalidateAfterSave) {
      this.revalidateAfterSave = false
      await this.revalidate()
    } else if (this.dirty && !this.theirs) {
      this.schedule() // edits made while saving
    }
  }

  async revalidate(): Promise<void> {
    if (this.saving) {
      this.revalidateAfterSave = true
      return
    }
    this.reading ??= this.read().finally(() => (this.reading = undefined))
    return this.reading
  }

  // Resolve a conflict by discarding local edits.
  takeTheirs() {
    if (this.theirs) this.apply(this.theirs)
  }

  // Resolve a conflict by writing local edits over the disk version.
  async keepMine() {
    if (!this.theirs) return
    this.etag = this.theirs.etag
    this.disk = splitFrontmatter(this.theirs.content)
    this.theirs = undefined
    await this.save()
  }

  // Save pending edits now, e.g. before switching documents.
  async flush() {
    if (this.dirty && !this.theirs) await this.save()
  }

  dispose() {
    clearTimeout(this.timer)
  }

  private schedule() {
    clearTimeout(this.timer)
    if (this.theirs) return
    if (!this.dirty) {
      this.listener.state('clean')
      return
    }
    this.listener.state('dirty')
    this.timer = setTimeout(() => this.save(), this.delay)
  }

  private async write(next: Split, markdown: string) {
    try {
      const result = await this.remote.write(this.path, joinFrontmatter(next), this.etag)
      if (result.kind === 'conflict') {
        this.revalidateAfterSave = true
        return
      }
      this.etag = result.etag
      this.disk = next
      this.baseline = markdown
      this.listener.state(this.dirty ? 'dirty' : 'clean')
    } catch {
      this.listener.state('error')
      this.timer = setTimeout(() => this.save(), retryDelay)
    }
  }

  private async read() {
    let result: ReadResult
    try {
      result = await this.remote.read(this.path, this.etag)
    } catch {
      return // the service is unreachable; the reconnect revalidates again
    }
    if (result.kind === 'unchanged') return
    if (result.kind === 'missing') {
      this.listener.state('missing')
      return
    }
    if (this.dirty) {
      clearTimeout(this.timer)
      this.theirs = result.doc
      this.listener.state('conflict')
      return
    }
    this.apply(result.doc)
  }

  private apply(doc: Doc) {
    clearTimeout(this.timer)
    this.theirs = undefined
    this.etag = doc.etag
    this.disk = splitFrontmatter(doc.content)
    this.frontmatter = this.disk.frontmatter
    this.listener.frontmatter(this.frontmatter)
    if (this.surface) {
      this.surface.replace(this.disk.body)
      this.baseline = this.surface.markdown()
    }
    this.listener.state('clean')
  }
}
