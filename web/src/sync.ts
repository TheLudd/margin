// Live updates from the service. The stream ends whenever the service
// restarts, the machine sleeps or the client falls behind; events sent in the
// meantime are lost, so every (re)connect is reported to resynchronize.

// A file added, changed or removed; the tree changed; or the HEAD of the
// repository at path moved, as on a commit.
export interface FileEvent {
  kind: 'added' | 'changed' | 'removed' | 'tree' | 'head'
  path: string
}

export interface SyncHandlers {
  connected(): void
  // The frontend the service serves, sent first on every connect.
  build(id: string): void
  event(event: FileEvent): void
}

// How long to wait before connecting again after the browser gave up,
// doubling while the service stays unreachable.
const firstRetry = 1000
const lastRetry = 10_000

export function connect(handlers: SyncHandlers): () => void {
  let source: EventSource
  let timer: ReturnType<typeof setTimeout> | undefined
  let retry = firstRetry
  let stopped = false
  const open = () => {
    source = new EventSource('/api/events')
    source.addEventListener('open', () => {
      retry = firstRetry
      handlers.connected()
    })
    source.addEventListener('build', (message) => handlers.build(message.data))
    source.addEventListener('message', (message) => handlers.event(JSON.parse(message.data)))
    // The browser reconnects a dropped stream itself, but gives up on an
    // error response, which a proxy sends while the service restarts.
    source.addEventListener('error', () => {
      if (stopped || source.readyState !== EventSource.CLOSED) return
      timer = setTimeout(open, retry)
      retry = Math.min(retry * 2, lastRetry)
    })
  }
  open()
  return () => {
    stopped = true
    clearTimeout(timer)
    source.close()
  }
}

// Calls fn once after calls stop for `wait` ms.
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
