import type { FileEntry } from '../api'

// One file of a project, checked out in one or more worktrees.
export interface LogicalFile {
  key: string
  project: string
  rel: string // path within the repository
  copies: FileEntry[] // the main checkout first, then by worktree
  preferred: FileEntry // the copy to open by default
  changed: boolean // some copy differs from the main checkout
  activeAt: number // last view or modification of any copy, in ms
}

const day = 24 * 60 * 60 * 1000

// Viewed or modified within the last `days` days.
export const isActive = (f: LogicalFile, days: number, now = Date.now()) => f.activeAt >= now - days * day

// When a copy was last viewed or modified.
function activityOf(copy: FileEntry): number {
  return Math.max(copy.viewed ? Date.parse(copy.viewed) : 0, copy.modified ? Date.parse(copy.modified) : 0)
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = groups.get(k)
    if (group) group.push(item)
    else groups.set(k, [item])
  }
  return groups
}

export const relPath = (f: FileEntry) => (f.repo === '' ? f.path : f.path.slice(f.repo.length + 1))

export const worktreeName = (f: FileEntry) => f.repo.slice(f.repo.lastIndexOf('/') + 1) || '~/code'

// Groups the copies of each file across a project's worktrees. The preferred
// copy is the one changed most recently; when no worktree changed the file,
// it is the main checkout's.
export function groupCopies(files: FileEntry[]): LogicalFile[] {
  const groups = groupBy(files, (f) => `${f.project}\0${relPath(f)}`)
  return [...groups].map(([key, copies]) => {
    copies.sort((a, b) => Number(b.main) - Number(a.main) || a.repo.localeCompare(b.repo))
    const changed = copies.filter((c) => c.changed).sort((a, b) => Date.parse(b.changed!) - Date.parse(a.changed!))
    return {
      key,
      project: copies[0].project,
      rel: relPath(copies[0]),
      copies,
      preferred: changed[0] ?? copies[0],
      changed: changed.some((c) => !c.main),
      activeAt: Math.max(...copies.map(activityOf)),
    }
  })
}
