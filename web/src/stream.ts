// The event stream (P-09, N-01, N-04, N-05, S-06): reopened with backoff
// after an error, and a reload when the build changed.
import type { StreamEvent } from './types'

export interface StreamHandlers {
  onEvent: (ev: StreamEvent) => void
  /** Called every time the stream (re)opens, after the first open. */
  onReconnect: () => void
  /** Called when the server runs a newer build; should save and reload. */
  onNewBuild: () => void
}

export const BACKOFF_START = 1000
export const BACKOFF_MAX = 10_000

/** The next backoff delay: doubling from 1s to 10s. */
export function nextBackoff(current: number): number {
  return Math.min(current * 2, BACKOFF_MAX)
}

export class Stream {
  private source: EventSource | null = null
  private build: string | null = null
  private backoff = BACKOFF_START
  private opened = 0
  private timer: number | null = null
  private closed = false

  constructor(private handlers: StreamHandlers) {}

  connect(): void {
    if (this.closed) return
    const src = new EventSource('/api/events')
    this.source = src
    src.addEventListener('open', () => {
      this.backoff = BACKOFF_START
      this.opened++
      if (this.opened > 1) this.handlers.onReconnect()
    })
    src.addEventListener('build', (ev) => {
      const id = (ev as MessageEvent).data as string
      if (this.build === null) this.build = id
      else if (this.build !== id) this.handlers.onNewBuild()
    })
    for (const name of ['file', 'lists', 'head', 'config'] as const) {
      src.addEventListener(name, (ev) => {
        let data: unknown = {}
        try {
          data = JSON.parse((ev as MessageEvent).data)
        } catch {
          data = {}
        }
        this.handlers.onEvent({ name, data } as StreamEvent)
      })
    }
    src.addEventListener('error', () => {
      src.close()
      if (this.source !== src) return
      this.source = null
      this.timer = window.setTimeout(() => this.connect(), this.backoff)
      this.backoff = nextBackoff(this.backoff)
    })
  }

  close(): void {
    this.closed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.source?.close()
    this.source = null
  }
}
