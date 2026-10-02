import { h } from './dom'

// Hides quick work so the overlay doesn't flash.
const showDelay = 150

// Covers the whole app while it waits on work that the rest of the app can't
// be used during, such as re-indexing after the folders change.
export class BusyOverlay {
  private readonly dialog = h('dialog', { class: 'busy' })
  private readonly label = h('p', {})

  constructor() {
    this.dialog.append(h('span', { class: 'spinner' }), this.label)
    this.dialog.addEventListener('cancel', (event) => event.preventDefault())
    document.body.append(this.dialog)
  }

  async during<T>(label: string, work: Promise<T>): Promise<T> {
    this.label.textContent = label
    const timer = setTimeout(() => this.dialog.showModal(), showDelay)
    try {
      return await work
    } finally {
      clearTimeout(timer)
      this.dialog.close()
    }
  }
}
