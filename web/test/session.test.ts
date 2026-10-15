import { describe, expect, it, vi } from 'vitest'
import { RETRY_DELAY, SAVE_DELAY, SaveError, Session, type Timers } from '../src/session'
import type { Doc } from '../src/types'

function fakeTimers(): Timers & { run(ms: number): void; pending(): number } {
  let now = 0
  let next = 1
  const list: { id: number; at: number; fn: () => void }[] = []
  return {
    set(fn, ms) {
      const id = next++
      list.push({ id, at: now + ms, fn })
      return id
    },
    clear(id) {
      const i = list.findIndex((t) => t.id === id)
      if (i >= 0) list.splice(i, 1)
    },
    run(ms) {
      const until = now + ms
      for (;;) {
        const due = list.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        list.splice(list.indexOf(due), 1)
        now = due.at
        due.fn()
      }
      now = until
    },
    pending: () => list.length,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function doc(content: string, etag: string): Doc {
  return { path: '/code/a.md', name: 'a.md', dir: '', content, etag, mtime: 0, git: '', manual: false, hasCopy: true, unread: false, copies: [], project: '' }
}

function make(opts: { saveImpl?: (p: string, c: string, e: string) => Promise<string>; fetchImpl?: (p: string, e?: string) => Promise<Doc | null> } = {}) {
  const timers = fakeTimers()
  const statuses: string[] = []
  const reloads: Doc[] = []
  const conflicts: Doc[] = []
  let missing = 0
  let content = 'original'
  const save = vi.fn(opts.saveImpl ?? (async () => '"e2"'))
  const fetch = vi.fn(opts.fetchImpl ?? (async () => null))
  const session = new Session(
    '/code/a.md',
    { save, fetch },
    { onStatus: (s) => statuses.push(s), onReload: (d) => reloads.push(d), onConflict: (d) => conflicts.push(d), onMissing: () => missing++ },
    () => content,
    timers,
  )
  session.load(doc('original', '"e1"'))
  return { session, timers, statuses, reloads, conflicts, save, fetch, setContent: (c: string) => (content = c), missing: () => missing }
}

describe('session', () => {
  it('D-03: an edit saves about a second after the last edit, with the etag, and only real edits save', async () => {
    const t = make()
    expect(t.save).not.toHaveBeenCalled()
    t.setContent('edited')
    t.session.edited()
    expect(t.statuses.at(-1)).toBe('unsaved')
    t.timers.run(SAVE_DELAY - 100)
    expect(t.save).not.toHaveBeenCalled()
    t.session.edited()
    t.timers.run(SAVE_DELAY - 100)
    expect(t.save).not.toHaveBeenCalled()
    t.timers.run(100)
    expect(t.save).toHaveBeenCalledWith('/code/a.md', 'edited', '"e1"')
    expect(t.statuses.at(-1)).toBe('saving')
    await flush()
    expect(t.statuses.at(-1)).toBe('saved')
    expect(t.session.etag).toBe('"e2"')
    expect(t.session.dirty).toBe(false)
  })

  it('D-17, P-09: flush saves a pending edit right away', async () => {
    const t = make()
    t.setContent('edited')
    t.session.edited()
    await t.session.flush()
    expect(t.save).toHaveBeenCalledTimes(1)
    expect(t.timers.pending()).toBe(0)
    await t.session.flush()
    expect(t.save).toHaveBeenCalledTimes(1)
  })

  it('D-03: an edit during a save is saved again afterwards', async () => {
    let resolve: (etag: string) => void = () => {}
    const t = make({ saveImpl: () => new Promise((r) => (resolve = r)) })
    t.session.edited()
    t.timers.run(SAVE_DELAY)
    expect(t.save).toHaveBeenCalledTimes(1)
    t.session.edited()
    resolve('"e2"')
    await flush()
    expect(t.statuses.at(-1)).toBe('unsaved')
    t.timers.run(SAVE_DELAY)
    expect(t.save).toHaveBeenCalledTimes(2)
    expect(t.save.mock.calls[1][2]).toBe('"e2"')
  })

  it('N-02: the echo of our own save is ignored', async () => {
    const t = make()
    t.session.edited()
    t.timers.run(SAVE_DELAY)
    await flush()
    await t.session.external('"e2"')
    expect(t.fetch).not.toHaveBeenCalled()
    expect(t.reloads).toHaveLength(0)
  })

  it('N-01: a change on disk with nothing pending reloads the document', async () => {
    const theirs = doc('theirs', '"e9"')
    const t = make({ fetchImpl: async () => theirs })
    await t.session.external('"e9"')
    expect(t.reloads).toEqual([theirs])
    expect(t.session.etag).toBe('"e9"')
    expect(t.statuses.at(-1)).toBe('saved')
  })

  it('N-06: a change on disk while dirty never overwrites: it is a conflict with keep mine and take theirs', async () => {
    const theirs = doc('theirs', '"e9"')
    const t = make({ fetchImpl: async () => theirs })
    t.setContent('mine')
    t.session.edited()
    await t.session.external('"e9"')
    expect(t.conflicts).toEqual([theirs])
    expect(t.statuses.at(-1)).toBe('conflict')
    expect(t.reloads).toHaveLength(0)
    expect(t.timers.pending()).toBe(0)
    await t.session.keepMine()
    expect(t.save).toHaveBeenCalledWith('/code/a.md', 'mine', '"e9"')
    expect(t.statuses.at(-1)).toBe('saved')
  })

  it('N-06: take theirs drops the edits and shows their version', async () => {
    const theirs = doc('theirs', '"e9"')
    const t = make({ fetchImpl: async () => theirs })
    t.session.edited()
    await t.session.external('"e9"')
    expect(t.session.takeTheirs()).toEqual(theirs)
    expect(t.reloads).toEqual([theirs])
    expect(t.session.dirty).toBe(false)
    expect(t.save).not.toHaveBeenCalled()
  })

  it('N-06, P-10: a save refused with 412 becomes a conflict', async () => {
    const theirs = doc('theirs', '"e9"')
    const t = make({ saveImpl: async () => Promise.reject(new SaveError(412)), fetchImpl: async () => theirs })
    t.session.edited()
    t.timers.run(SAVE_DELAY)
    await flush()
    await flush()
    expect(t.statuses.at(-1)).toBe('conflict')
    expect(t.conflicts).toEqual([theirs])
  })

  it('N-07: a failed save retries after 5s and the status says so', async () => {
    let fail = true
    const t = make({ saveImpl: async () => (fail ? Promise.reject(new SaveError(0)) : '"e2"') })
    t.session.edited()
    t.timers.run(SAVE_DELAY)
    await flush()
    expect(t.statuses.at(-1)).toBe('retrying')
    t.timers.run(RETRY_DELAY - 1)
    expect(t.save).toHaveBeenCalledTimes(1)
    fail = false
    t.timers.run(1)
    expect(t.save).toHaveBeenCalledTimes(2)
    await flush()
    expect(t.statuses.at(-1)).toBe('saved')
  })

  it('D-15: a removed file shows deleted and edits are not saved', async () => {
    const t = make()
    t.session.removed()
    expect(t.statuses.at(-1)).toBe('deleted')
    expect(t.missing()).toBe(1)
    t.session.edited()
    t.timers.run(SAVE_DELAY)
    await flush()
    expect(t.save).not.toHaveBeenCalled()
    const t2 = make({ saveImpl: async () => Promise.reject(new SaveError(404)) })
    t2.session.edited()
    t2.timers.run(SAVE_DELAY)
    await flush()
    expect(t2.statuses.at(-1)).toBe('deleted')
    expect(t2.missing()).toBe(1)
  })

  it('N-03, N-04: revalidation is a conditional GET; unchanged does nothing, changed reloads or conflicts', async () => {
    const theirs = doc('theirs', '"e9"')
    let changed = false
    const t = make({ fetchImpl: async (_p, etag) => (changed ? theirs : etag === '"e1"' ? null : theirs) })
    await t.session.revalidate()
    expect(t.fetch).toHaveBeenCalledWith('/code/a.md', '"e1"')
    expect(t.reloads).toHaveLength(0)
    changed = true
    await t.session.revalidate()
    expect(t.reloads).toEqual([theirs])
    t.session.edited()
    const other = doc('other', '"e10"')
    t.fetch.mockResolvedValueOnce(other)
    await t.session.revalidate()
    expect(t.conflicts).toEqual([other])
  })
})
