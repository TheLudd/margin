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
  event(event: FileEvent): void
}

export function connect(handlers: SyncHandlers): () => void {
  const source = new EventSource('/api/events')
  source.addEventListener('open', () => handlers.connected())
  source.addEventListener('message', (message) => handlers.event(JSON.parse(message.data)))
  return () => source.close()
}

// Calls fn once after calls stop for `wait` ms.
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
