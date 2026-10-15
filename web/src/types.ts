// Shapes shared with the Go API.

export interface RootView {
  name: string
  path: string
}

export interface Entry {
  path: string
  name: string
  dir: string
  time?: number
  kind?: 'view' | 'modified'
  unread: boolean
  copies?: number
  copiesChanged?: boolean
}

export interface Group {
  project: string
  files: Entry[]
}

export interface Lists {
  roots: RootView[]
  activeDays: number
  recent: Entry[]
  older: Group[]
}

export interface CopyView {
  path: string
  label: string
  state: 'main' | 'unchanged' | 'changed'
  time?: number
}

export type GitState = '' | 'committed' | 'uncommitted' | 'untracked'

export interface Doc {
  path: string
  name: string
  dir: string
  content: string
  etag: string
  mtime: number
  git: GitState
  manual: boolean
  hasCopy: boolean
  unread: boolean
  copies: CopyView[]
  project: string
}

export interface Meta {
  path: string
  git: GitState
  manual: boolean
  hasCopy: boolean
  unread: boolean
  copies: CopyView[]
  project: string
  etag: string
}

export interface ConfigRoot {
  name: string
  path: string
}

export interface Config {
  roots: ConfigRoot[]
  exclude: string[]
  activeDays: number
  unreadDays: number
}

export interface SettingsView {
  config: Config
  file: string
  state: string
  error: string
}

export interface Suggestion {
  path: string
  count: number
  partial: boolean
}

export type StreamEvent =
  | { name: 'build'; data: string }
  | { name: 'file'; data: { path: string; kind: 'added' | 'changed' | 'removed'; etag: string } }
  | { name: 'lists'; data: unknown }
  | { name: 'head'; data: { repo: string } }
  | { name: 'config'; data: unknown }
