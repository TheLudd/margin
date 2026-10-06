import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './sync'

// An event stream the test opens, fails and closes.
class FakeSource extends EventTarget {
  static readonly CLOSED = 2
  static opened: FakeSource[] = []
  readyState = 0

  constructor(readonly url: string) {
    super()
    FakeSource.opened.push(this)
  }

  // The browser gave up, as on an error response.
  fail() {
    this.readyState = FakeSource.CLOSED
    this.dispatchEvent(new Event('error'))
  }

  close() {
    this.readyState = FakeSource.CLOSED
  }
}

const handlers = { connected: () => {}, build: () => {}, event: () => {} }
let stop: () => void

beforeEach(() => {
  FakeSource.opened = []
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', FakeSource)
  stop = connect(handlers)
})

afterEach(() => {
  stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('connect when the browser gives up on the stream', () => {
  beforeEach(() => FakeSource.opened[0].fail())

  it('connects again after a second', () => {
    vi.advanceTimersByTime(999)
    expect(FakeSource.opened.length).toBe(1)
    vi.advanceTimersByTime(1)
    expect(FakeSource.opened.length).toBe(2)
  })

  it('waits longer each time it fails', () => {
    vi.advanceTimersByTime(1000)
    FakeSource.opened[1].fail()
    vi.advanceTimersByTime(1999)
    expect(FakeSource.opened.length).toBe(2)
    vi.advanceTimersByTime(1)
    expect(FakeSource.opened.length).toBe(3)
  })
})

describe('connect when the stream drops but the browser reconnects', () => {
  beforeEach(() => FakeSource.opened[0].dispatchEvent(new Event('error')))

  it('leaves it to the browser', () => {
    vi.advanceTimersByTime(60_000)
    expect(FakeSource.opened.length).toBe(1)
  })
})

describe('connect once stopped', () => {
  beforeEach(() => {
    stop()
    FakeSource.opened[0].fail()
  })

  it('does not connect again', () => {
    vi.advanceTimersByTime(60_000)
    expect(FakeSource.opened.length).toBe(1)
  })
})
