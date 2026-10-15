// The JSON API, one function per endpoint.
import type { Config, Doc, Lists, Meta, SettingsView, Suggestion } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function failure(res: Response): Promise<ApiError> {
  let message = res.statusText
  try {
    const body = await res.json()
    if (body && typeof body.error === 'string') message = body.error
  } catch {
    // Not JSON; keep the status text.
  }
  return new ApiError(res.status, message)
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await failure(res)
  return (await res.json()) as T
}

function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export const api = {
  lists: (): Promise<Lists> => fetch('/api/lists').then((r) => json<Lists>(r)),

  /** Reads a file; with an etag, answers null when it is unchanged (304). */
  async file(path: string, etag?: string): Promise<Doc | null> {
    const headers: Record<string, string> = {}
    if (etag) headers['If-None-Match'] = etag
    const res = await fetch('/api/file' + encodePath(path), { headers })
    if (res.status === 304) return null
    return json<Doc>(res)
  },

  meta: (path: string): Promise<Meta> => fetch('/api/meta' + encodePath(path)).then((r) => json<Meta>(r)),

  async save(path: string, content: string, etag: string): Promise<string> {
    const res = await fetch('/api/file' + encodePath(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown', 'If-Match': etag },
      body: content,
    })
    const out = await json<{ etag: string }>(res)
    return out.etag
  },

  async baseline(path: string, kind: 'read' | 'head'): Promise<string | null> {
    const res = await fetch('/api/baseline' + encodePath(path) + '?kind=' + kind)
    if (res.status === 404) return null
    if (!res.ok) throw await failure(res)
    return res.text()
  },

  open: (path: string) => post('/api/open', { path }).then((r) => json<unknown>(r)),
  markRead: (path: string) => post('/api/read', { path }).then((r) => json<unknown>(r)),
  manual: (path: string, manual: boolean) => post('/api/manual', { path, manual }).then((r) => json<unknown>(r)),
  dismiss: (path: string) => post('/api/dismiss', { path }).then((r) => json<unknown>(r)),

  settings: (): Promise<SettingsView> => fetch('/api/settings').then((r) => json<SettingsView>(r)),

  async saveSettings(config: Config): Promise<{ reindexed: boolean }> {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    return json<{ reindexed: boolean }>(res)
  },

  suggest: (): Promise<Suggestion[]> => fetch('/api/suggest').then((r) => json<Suggestion[]>(r)),
  complete: (q: string): Promise<string[]> =>
    fetch('/api/complete?q=' + encodeURIComponent(q)).then((r) => json<string[]>(r)),
}

/** Encodes a margin path for a URL, keeping its slashes. */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}
