import { h } from './dom'

// Whether the open document is being edited. Documents open for reading, so
// selecting text to copy it changes nothing; E or the header button starts
// editing and Escape stops it. Phones only read, so there it isn't offered.
export class EditMode {
  readonly el = h('button', { type: 'button', class: 'badge edit', title: 'Edit (E)' }, 'edit')
  private _editing = false
  private available = true

  // changed is called whenever editing starts or stops; keys is where E is
  // listened for.
  constructor(
    private readonly changed: (editing: boolean) => void,
    keys: EventTarget = document,
  ) {
    this.el.onclick = () => this.set(!this._editing)
    keys.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent
      if (event.key !== 'e' || event.ctrlKey || event.metaKey || event.altKey || this._editing || typing(event.target)) return
      event.preventDefault()
      this.set(true)
    })
  }

  get editing(): boolean {
    return this._editing
  }

  set(editing: boolean) {
    if (editing && !this.available) return
    if (editing === this._editing) return
    this._editing = editing
    this.render()
    this.changed(editing)
  }

  // A new document opens for reading. Called before it is shown, so it
  // doesn't report the change.
  reset() {
    this._editing = false
    this.render()
  }

  // Whether editing is offered at all.
  setAvailable(available: boolean) {
    this.available = available
    this.el.hidden = !available
    if (!available) this.set(false)
  }

  private render() {
    this.el.classList.toggle('active', this._editing)
    this.el.textContent = this._editing ? 'editing' : 'edit'
    this.el.title = this._editing ? 'Stop editing (Esc)' : 'Edit (E)'
  }
}

// Whether keys typed into target are text, such as in the finder or the
// frontmatter.
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}
