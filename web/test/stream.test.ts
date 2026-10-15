import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKOFF_MAX, BACKOFF_START, nextBackoff, Stream } from '../src/stream'

type Listener = (ev: Event) => void

class FakeSource {
  static instances: FakeSource[] = []
  listeners = new Map<string, Listener[]>()
  closed = false
  constructor(public url: string) {
    FakeSource.instances.push(this)
  }
  addEventListener(name: string, fn: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn])
  }
  close() {
    this.closed = true
  }
  emit(name: string, data?: string) {
    for (const fn of this.listeners.get(name) ?? []) fn(data === undefined ? new Event(name) : new MessageEvent(name, { data }))
  }
}

describe('stream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSource.instances = []
    vi.stubGlobal('EventSource', FakeSource)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('N-04: after an error the stream is reopened with backoff from 1s doubling to 10s', () => {
    expect(nextBackoff(BACKOFF_START)).toBe(2000)
    expect(nextBackoff(8000)).toBe(BACKOFF_MAX)
    expect(nextBackoff(BACKOFF_MAX)).toBe(BACKOFF_MAX)
    const s = new Stream({ onEvent: () => {}, onReconnect: () => {}, onNewBuild: () => {} })
    s.connect()
    expect(FakeSource.instances).toHaveLength(1)
    FakeSource.instances[0].emit('error')
    expect(FakeSource.instances[0].closed).toBe(true)
    vi.advanceTimersByTime(999)
    expect(FakeSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSource.instances).toHaveLength(2)
    FakeSource.instances[1].emit('error')
    vi.advanceTimersByTime(1999)
    expect(FakeSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSource.instances).toHaveLength(3)
    for (const wait of [4000, 8000, 10000, 10000]) {
      const n = FakeSource.instances.length
      FakeSource.instances[n - 1].emit('error')
      vi.advanceTimersByTime(wait - 1)
      expect(FakeSource.instances).toHaveLength(n)
      vi.advanceTimersByTime(1)
      expect(FakeSource.instances).toHaveLength(n + 1)
    }
    s.close()
  })

  it('N-04, S-06: every open is reported, a reconnect only after the first, and a reconnect resets the backoff', () => {
    const reconnects = vi.fn()
    const opens = vi.fn()
    const s = new Stream({ onEvent: () => {}, onOpen: opens, onReconnect: reconnects, onNewBuild: () => {} })
    s.connect()
    FakeSource.instances[0].emit('open')
    expect(opens).toHaveBeenCalledTimes(1)
    expect(reconnects).not.toHaveBeenCalled()
    FakeSource.instances[0].emit('error')
    vi.advanceTimersByTime(1000)
    FakeSource.instances[1].emit('error')
    vi.advanceTimersByTime(2000)
    FakeSource.instances[2].emit('open')
    expect(reconnects).toHaveBeenCalledTimes(1)
    expect(opens).toHaveBeenCalledTimes(2)
    FakeSource.instances[2].emit('error')
    vi.advanceTimersByTime(1000)
    expect(FakeSource.instances).toHaveLength(4)
    s.close()
  })

  it('P-09: the build id is remembered from the first connection and a different one asks for a reload', () => {
    const newBuild = vi.fn()
    const s = new Stream({ onEvent: () => {}, onReconnect: () => {}, onNewBuild: newBuild })
    s.connect()
    FakeSource.instances[0].emit('build', 'one')
    FakeSource.instances[0].emit('build', 'one')
    expect(newBuild).not.toHaveBeenCalled()
    FakeSource.instances[0].emit('error')
    vi.advanceTimersByTime(1000)
    FakeSource.instances[1].emit('build', 'two')
    expect(newBuild).toHaveBeenCalledTimes(1)
    s.close()
  })

  it('S-06, N-01, N-05: file, lists, head and config events are passed on with their data', () => {
    const events = vi.fn()
    const s = new Stream({ onEvent: events, onReconnect: () => {}, onNewBuild: () => {} })
    s.connect()
    FakeSource.instances[0].emit('file', '{"path":"/code/a.md","kind":"changed","etag":"\\"x\\""}')
    FakeSource.instances[0].emit('head', '{"repo":"/code/repo"}')
    FakeSource.instances[0].emit('lists', '{}')
    FakeSource.instances[0].emit('config', 'not json')
    expect(events.mock.calls.map((c) => c[0])).toEqual([
      { name: 'file', data: { path: '/code/a.md', kind: 'changed', etag: '"x"' } },
      { name: 'head', data: { repo: '/code/repo' } },
      { name: 'lists', data: {} },
      { name: 'config', data: {} },
    ])
    s.close()
  })
})
