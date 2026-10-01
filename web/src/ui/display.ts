// Every path starts with its root's name. With a single root that is noise,
// so it is left out wherever paths are shown (but kept in URLs).

let single: string | undefined

export function setRoots(names: string[]) {
  single = names.length === 1 ? names[0] : undefined
}

export function display(path: string): string {
  if (single === undefined) return path
  if (path === single) return ''
  return path.startsWith(single + '/') ? path.slice(single.length + 1) : path
}
