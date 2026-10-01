import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadResult, WriteResult } from '../api'
import { DocumentSession, type Remote, type State, type Surface } from './session'

const delay = 800
const original = '---\nname: skill\n---\n# Title\n\n* one\n'

// The disk, with etags that change on every write.
class FakeRemote implements Remote {
  content = original
  version = 1
  writes = 0

  get etag() {
    return `"v${this.version}"`
  }

  external(content: string) {
    this.content = content
    this.version++
  }

  async read(_: string, etag?: string): Promise<ReadResult> {
    if (this.content === '') return { kind: 'missing' }
    if (etag === this.etag) return { kind: 'unchanged' }
    return { kind: 'doc', doc: { content: this.content, etag: this.etag } }
  }

  async write(_: string, content: string, etag: string): Promise<WriteResult> {
    if (etag !== this.etag) return { kind: 'conflict' }
    this.writes++
    this.external(content)
    return { kind: 'saved', etag: this.etag }
  }
}

// An editor that normalizes `*` bullets to `-`, like Milkdown.
class FakeSurface implements Surface {
  text = ''
  replaced = 0

  markdown() {
    return this.text.replace(/^\* /gm, '- ')
  }

  replace(body: string) {
    this.text = body
    this.replaced++
  }
}

let remote: FakeRemote
let surface: FakeSurface
let session: DocumentSession
let states: State[]
let frontmatters: string[]

const lastState = () => states.at(-1)

function edit(change: (text: string) => string) {
  surface.text = change(surface.text)
  session.edited()
}

beforeEach(async () => {
  vi.useFakeTimers()
  remote = new FakeRemote()
  surface = new FakeSurface()
  states = []
  frontmatters = []
  const read = await remote.read('plan.md')
  if (read.kind !== 'doc') throw new Error('setup')
  session = new DocumentSession('plan.md', read.doc, remote, {
    state: (s) => states.push(s),
    frontmatter: (f) => frontmatters.push(f),
  }, delay)
  surface.text = session.body
  session.attach(surface)
})

afterEach(() => {
  session.dispose()
  vi.useRealTimers()
})

describe('DocumentSession when opened', () => {
  it('loads the body without frontmatter', () => expect(session.body).toBe('# Title\n\n* one\n'))

  it('is not dirty although the editor normalizes', () => expect(session.dirty).toBe(false))

  it('never writes', async () => {
    await vi.advanceTimersByTimeAsync(delay * 10)
    expect(remote.writes).toBe(0)
  })
})

describe('DocumentSession when the body is edited', () => {
  beforeEach(async () => {
    edit((t) => t + '\nmore\n')
    await vi.advanceTimersByTimeAsync(delay)
  })

  it('autosaves, keeping frontmatter and untouched formatting', () =>
    expect(remote.content).toBe('---\nname: skill\n---\n# Title\n\n* one\n\nmore\n'))

  it('reports clean', () => expect(lastState()).toBe('clean'))

  describe('and revalidated', () => {
    beforeEach(() => session.revalidate())

    it('does not reload its own save', () => expect(surface.replaced).toBe(0))
  })
})

describe('DocumentSession when an edit is undone before the delay', () => {
  beforeEach(async () => {
    edit((t) => t + 'typo')
    edit((t) => t.replace('typo', ''))
    await vi.advanceTimersByTimeAsync(delay)
  })

  it('does not write', () => expect(remote.writes).toBe(0))

  it('reports clean', () => expect(lastState()).toBe('clean'))
})

describe('DocumentSession when the frontmatter is edited', () => {
  beforeEach(async () => {
    session.editFrontmatter('---\nname: renamed\n---\n')
    await vi.advanceTimersByTimeAsync(delay)
  })

  it('saves it with the body', () => expect(remote.content).toBe('---\nname: renamed\n---\n# Title\n\n* one\n'))
})

describe('DocumentSession when flushed with pending edits', () => {
  beforeEach(async () => {
    edit((t) => t + 'pending\n')
    await session.flush()
  })

  it('saves without waiting for the delay', () => expect(remote.content).toContain('pending'))
})

describe('DocumentSession when the file changes on disk', () => {
  beforeEach(async () => {
    remote.external('---\nname: claude\n---\n# Rewritten\n')
    await session.revalidate()
  })

  it('shows the new body', () => expect(surface.text).toBe('# Rewritten\n'))

  it('shows the new frontmatter', () => expect(frontmatters).toEqual(['---\nname: claude\n---\n']))

  it('stays clean', () => expect(session.dirty).toBe(false))
})

describe('DocumentSession when the file changes on disk with unsaved edits', () => {
  beforeEach(async () => {
    edit((t) => t + 'mine\n')
    remote.external('# Theirs\n')
    await session.revalidate()
  })

  it('reports a conflict', () => expect(lastState()).toBe('conflict'))

  it('keeps the local edits', () => expect(surface.text).toContain('mine'))

  it('does not autosave over the disk', async () => {
    await vi.advanceTimersByTimeAsync(delay * 10)
    expect(remote.content).toBe('# Theirs\n')
  })

  describe('and keepMine is chosen', () => {
    beforeEach(() => session.keepMine())

    it('writes the local version', () => expect(remote.content).toContain('mine'))
  })

  describe('and takeTheirs is chosen', () => {
    beforeEach(() => session.takeTheirs())

    it('shows the disk version', () => expect(surface.text).toBe('# Theirs\n'))

    it('reports clean', () => expect(lastState()).toBe('clean'))
  })
})

describe('DocumentSession when a save races an external change', () => {
  beforeEach(async () => {
    edit((t) => t + 'mine\n')
    remote.external('# Theirs\n')
    await vi.advanceTimersByTimeAsync(delay)
  })

  it('reports a conflict', () => expect(lastState()).toBe('conflict'))

  it('leaves the disk alone', () => expect(remote.content).toBe('# Theirs\n'))
})

describe('DocumentSession when the file is deleted', () => {
  beforeEach(async () => {
    remote.external('')
    await session.revalidate()
  })

  it('reports it missing', () => expect(lastState()).toBe('missing'))
})
