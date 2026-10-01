// Client for the margin service.

export interface Doc {
  content: string
  etag: string
}

export type ReadResult = { kind: 'unchanged' } | { kind: 'missing' } | { kind: 'doc'; doc: Doc }

export type WriteResult = { kind: 'saved'; etag: string } | { kind: 'conflict' }

export interface FileEntry {
  path: string
  repo: string
  mtime: string
  project: string // the repo, or the worktree family it belongs to
  main: boolean // the repo is its project's main checkout
  changed?: string // when the repo changed the file relative to main
  viewed?: string // when the file was last viewed in margin
}

export interface Activity {
  path: string
  at: string
  kind: 'viewed' | 'modified' // whichever was last
}

// The service is the source of truth, so the browser cache is never used.
const noStore: RequestInit = { cache: 'no-store' }

const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`

export async function readFile(path: string, etag?: string): Promise<ReadResult> {
  const res = await fetch(fileUrl(path), { ...noStore, headers: etag ? { 'If-None-Match': etag } : {} })
  if (res.status === 304) return { kind: 'unchanged' }
  if (res.status === 404) return { kind: 'missing' }
  if (!res.ok) throw new Error(`read ${path}: ${res.status}`)
  return { kind: 'doc', doc: { content: await res.text(), etag: res.headers.get('ETag')! } }
}

export async function writeFile(path: string, content: string, etag: string): Promise<WriteResult> {
  const res = await fetch(fileUrl(path), { ...noStore, method: 'PUT', body: content, headers: { 'If-Match': etag } })
  if (res.status === 412) return { kind: 'conflict' }
  if (!res.ok) throw new Error(`save ${path}: ${res.status}`)
  return { kind: 'saved', etag: res.headers.get('ETag')! }
}

export async function fetchTree(): Promise<FileEntry[]> {
  return (await fetch('/api/tree', noStore)).json()
}

export async function fetchRecent(): Promise<Activity[]> {
  return (await fetch('/api/recent', noStore)).json()
}

// Removes a file from recent activity until it is viewed or changed again.
export async function forgetRecent(path: string): Promise<void> {
  await fetch(`/api/recent?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

export async function markViewed(path: string): Promise<void> {
  await fetch(`/api/recent?path=${encodeURIComponent(path)}`, { method: 'POST' })
}

export interface RootSettings {
  name: string
  path: string
  files?: number
}

export interface Settings {
  file: string // where the config is stored
  roots: RootSettings[]
  exclude: string[] // file patterns left out
  error?: string // why the config file could not be used
}

export async function fetchSettings(): Promise<Settings> {
  return (await fetch('/api/settings', noStore)).json()
}

export type SaveResult = { kind: 'saved'; settings: Settings } | { kind: 'invalid'; message: string }

export async function saveSettings(roots: RootSettings[], exclude: string[]): Promise<SaveResult> {
  const body = JSON.stringify({ roots: roots.map(({ name, path }) => ({ name, path })), exclude })
  const res = await fetch('/api/settings', { ...noStore, method: 'PUT', body, headers: { 'Content-Type': 'application/json' } })
  if (res.status === 400) return { kind: 'invalid', message: (await res.text()).trim() }
  if (!res.ok) throw new Error(`save settings: ${res.status}`)
  return { kind: 'saved', settings: await res.json() }
}

export async function suggestDirs(path: string): Promise<string[]> {
  return (await fetch(`/api/dirs?path=${encodeURIComponent(path)}`, noStore)).json()
}
