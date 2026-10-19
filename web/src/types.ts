// Shapes shared with the Go API.

export interface RootView {
  name: string
  path: string
}

/** A file type (F-07): its name and the mark drawn before the file name. */
export type TypeColor = 'cyan' | 'magenta' | 'green' | 'amber' | 'blue'

export interface FileType {
  name: string
  mark: string
  color: TypeColor
}

export interface Entry {
  path: string
  name: string
  dir: string
  type?: FileType
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
  type?: FileType
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

export interface ConfigType {
  name: string
  match: string
  mark?: string
  color?: TypeColor
}

export interface Config {
  roots: ConfigRoot[]
  exclude: string[]
  types: ConfigType[]
  activeDays: number
  unreadDays: number
}

export interface SettingsView {
  config: Config
  file: string
  state: string
  error: string
}

export interface TypeSuggestion {
  name: string
  match: string
  count: number
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
