// The document session (D-03, D-15, D-17, N-02, N-03, N-06, N-07): when to
// save, what to do when the file changes under us, and what the status says.
import type { Doc } from './types'

export type Status = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'deleted' | 'retrying'

export const SAVE_DELAY = 1000
export const RETRY_DELAY = 5000

export interface SessionIO {
  save(path: string, content: string, etag: string): Promise<string>
  fetch(path: string, etag?: string): Promise<Doc | null>
}

export interface SessionHooks {
  onStatus(status: Status): void
  /** The file changed on disk and we had nothing pending: show this version. */
  onReload(doc: Doc): void
  /** The file changed on disk while we had edits: ask (N-06). */
  onConflict(theirs: Doc): void
  onMissing(): void
  /** After a save: the etag the file has now. */
  onSaved?(etag: string): void
}

export class SaveError extends Error {
  constructor(public status: number) {
    super(`save failed: ${status}`)
  }
}

export interface Timers {
  set(fn: () => void, ms: number): number
  clear(id: number): void
}

const realTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
}

export class Session {
  etag = ''
  dirty = false
  missing = false
  status: Status = 'saved'
  private timer: number | null = null
  private retryTimer: number | null = null
  private saving: Promise<void> | null = null
  private editedWhileSaving = false
  private theirs: Doc | null = null

  constructor(
    public readonly path: string,
    private io: SessionIO,
    private hooks: SessionHooks,
    private produce: () => string,
    private timers: Timers = realTimers,
  ) {}

  /** Takes a freshly read version as the base. */
  load(doc: Doc): void {
    this.etag = doc.etag
    this.dirty = false
    this.missing = false
    this.theirs = null
    this.cancelTimers()
    this.setStatus('saved')
  }

  private setStatus(s: Status): void {
    this.status = s
    this.hooks.onStatus(s)
  }

  private cancelTimers(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer)
    this.timer = this.retryTimer = null
  }

  /** The reader changed something: save about a second after the last edit. */
  edited(): void {
    this.dirty = true
    if (this.saving) {
      this.editedWhileSaving = true
      return
    }
    if (this.status === 'conflict' || this.status === 'deleted') return
    this.setStatus('unsaved')
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = this.timers.set(() => {
      this.timer = null
      void this.save()
    }, SAVE_DELAY)
  }

  /** Saves now if anything is pending (D-17, P-09). */
  async flush(): Promise<void> {
    if (this.saving) {
      await this.saving
    }
    if (this.dirty && this.status !== 'conflict' && this.status !== 'deleted') {
      this.cancelTimers()
      await this.save()
    }
  }

  private save(): Promise<void> {
    if (this.saving) return this.saving
    if (this.missing) {
      this.setStatus('deleted')
      return Promise.resolve()
    }
    this.setStatus('saving')
    const content = this.produce()
    this.editedWhileSaving = false
    this.saving = this.io
      .save(this.path, content, this.etag)
      .then((etag) => {
        this.etag = etag
        this.hooks.onSaved?.(etag)
        this.saving = null
        if (this.editedWhileSaving) {
          this.editedWhileSaving = false
          this.dirty = true
          this.setStatus('unsaved')
          this.timer = this.timers.set(() => {
            this.timer = null
            void this.save()
          }, SAVE_DELAY)
        } else {
          this.dirty = false
          this.setStatus('saved')
        }
      })
      .catch(async (err: unknown) => {
        this.saving = null
        const status = err instanceof SaveError ? err.status : 0
        if (status === 412) {
          this.setStatus('conflict')
          const theirs = await this.io.fetch(this.path).catch(() => null)
          if (theirs) {
            this.theirs = theirs
            this.hooks.onConflict(theirs)
          }
          return
        }
        if (status === 404) {
          this.missing = true
          this.setStatus('deleted')
          this.hooks.onMissing()
          return
        }
        this.setStatus('retrying')
        this.retryTimer = this.timers.set(() => {
          this.retryTimer = null
          void this.save()
        }, RETRY_DELAY)
      })
    return this.saving
  }

  /** A push says the file changed on disk, to a version with this etag. */
  async external(etag: string): Promise<void> {
    if (etag === this.etag) return
    if (this.missing) this.missing = false
    const doc = await this.io.fetch(this.path).catch(() => null)
    if (!doc) return
    this.arrived(doc)
  }

  /** A push says the file is gone (D-15). */
  removed(): void {
    this.missing = true
    this.cancelTimers()
    this.setStatus('deleted')
    this.hooks.onMissing()
  }

  /** On focus, visibility and reconnect: a conditional GET (N-03, N-04). */
  async revalidate(): Promise<void> {
    let doc: Doc | null
    try {
      doc = await this.io.fetch(this.path, this.etag)
    } catch (err) {
      if (err instanceof SaveError && err.status === 404) {
        if (!this.missing) this.removed()
      }
      return
    }
    if (!doc) return
    this.arrived(doc)
  }

  private arrived(doc: Doc): void {
    if (doc.etag === this.etag) return
    if (this.dirty || this.saving) {
      this.theirs = doc
      this.cancelTimers()
      this.setStatus('conflict')
      this.hooks.onConflict(doc)
      return
    }
    this.load(doc)
    this.hooks.onReload(doc)
  }

  /** Conflict answer: keep mine, written over theirs. */
  async keepMine(): Promise<void> {
    if (this.theirs) this.etag = this.theirs.etag
    this.theirs = null
    this.dirty = true
    this.missing = false
    await this.save()
  }

  /** Conflict answer: take theirs, dropping my edits. */
  takeTheirs(): Doc | null {
    const doc = this.theirs
    if (!doc) return null
    this.load(doc)
    this.hooks.onReload(doc)
    return doc
  }

  destroy(): void {
    this.cancelTimers()
  }
}
