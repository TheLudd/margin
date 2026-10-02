import { type Folder, fetchHomeFolders } from '../api'
import { fileName, h } from './dom'

// How many files folder holds, marking a count that ran out of time.
export const fileCount = (folder: Folder) => `${folder.files}${folder.complete ? '' : '+'}`

// Suggests the folders in the home folder that hold markdown, each with a
// button to add it. Folders already served are left out.
export class FolderSuggestions {
  readonly element = h('div', { class: 'suggestions' })
  private folders: Folder[] | 'loading' | 'failed' = 'loading'
  private served = new Set<string>()
  private loads = 0

  constructor(private readonly add: (folder: Folder) => void) {}

  async load() {
    const load = ++this.loads
    this.folders = 'loading'
    this.render()
    let folders: FolderSuggestions['folders']
    try {
      folders = await fetchHomeFolders()
    } catch {
      folders = 'failed'
    }
    if (load !== this.loads) return
    this.folders = folders
    this.render()
  }

  // Leaves out the folders at paths.
  exclude(paths: string[]) {
    this.served = new Set(paths)
    this.render()
  }

  private render() {
    if (this.folders === 'loading') {
      return this.element.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Looking for folders…'))
    }
    if (this.folders === 'failed') return this.element.replaceChildren(h('p', {}, 'Folders could not be listed.'))
    const shown = this.folders.filter((f) => !this.served.has(f.path))
    if (shown.length === 0) return this.element.replaceChildren(h('p', {}, 'No other folders in your home hold markdown.'))
    this.element.replaceChildren(...shown.map((folder) => this.row(folder)))
  }

  private row(folder: Folder): HTMLElement {
    const add = h('button', { type: 'button', class: 'add', title: 'Add folder' }, '+')
    add.addEventListener('click', () => this.add(folder))
    return h(
      'div',
      { class: 'root suggestion' },
      h('span', { class: 'name' }, fileName(folder.path)),
      h('span', { class: 'path' }, folder.path),
      h('span', { class: 'files' }, fileCount(folder)),
      add,
    )
  }
}
