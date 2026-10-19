// How files and times are shown (F-04, F-07, L-12).
import type { FileType } from './types'

/** A relative time, short, for the sidebar: now, 5m, 3h, 2d, 3w. */
export function relativeTime(unixSeconds: number, now: number = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - unixSeconds))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 14) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

/** A relative time in words, for the copies select: changed 3h ago. */
export function relativeWords(unixSeconds: number, now: number = Date.now() / 1000): string {
  const short = relativeTime(unixSeconds, now)
  if (short === 'now') return 'just now'
  const unit = short.slice(-1)
  const n = short.slice(0, -1)
  const names: Record<string, string> = { m: 'minute', h: 'hour', d: 'day', w: 'week' }
  return `${n} ${names[unit]}${n === '1' ? '' : 's'} ago`
}

export interface LabelOptions {
  /** The file's type (F-07): its mark is drawn before the name. */
  type?: FileType
  /** The file's address, for the tooltip of a typed file, whose name is not its file name. */
  path?: string
}

/**
 * A file label (F-04): the name first, then its folder in muted, smaller
 * text. The folder shrinks first; the name is cut only when it alone
 * doesn't fit. A typed file (F-07) has its mark before the name.
 */
export function fileLabel(name: string, dir: string, opts: LabelOptions = {}): HTMLSpanElement {
  const label = document.createElement('span')
  label.className = 'file-label'
  if (opts.type) {
    const m = document.createElement('span')
    m.className = 'mark'
    m.textContent = opts.type.mark
    if ([...opts.type.mark].length === 1) m.classList.add('glyph')
    m.setAttribute('aria-label', opts.type.name)
    label.append(m)
  }
  const n = document.createElement('span')
  n.className = 'name'
  n.textContent = name
  label.append(n)
  if (dir) {
    const d = document.createElement('span')
    d.className = 'dir'
    d.textContent = dir
    label.append(d)
  }
  const at = dir ? `${dir}/${name}` : name
  label.title = opts.type ? `${opts.type.name} · ${opts.path?.replace(/^\//, '') ?? at}` : at
  return label
}

/** Splits a margin path into its root, name and folder as displayed. */
export function splitPath(path: string, singleRoot: boolean): { root: string; name: string; dir: string } {
  const parts = path.replace(/^\//, '').split('/')
  const root = parts[0] ?? ''
  const name = parts[parts.length - 1] ?? ''
  const middle = parts.slice(1, -1)
  const dir = singleRoot ? middle.join('/') : [root, ...middle].join('/')
  return { root, name, dir }
}
