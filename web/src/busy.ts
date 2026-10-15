// The busy overlay (C-07, L-35): a spinner and a label over a blurred
// backdrop while the app re-indexes.
import { el } from './shell'

let dialog: HTMLDialogElement | null = null

function ensure(): HTMLDialogElement {
  if (!dialog) {
    dialog = el('dialog', { class: 'busy' }, el('div', { class: 'spinner' }), el('p'))
    document.body.append(dialog)
  }
  return dialog
}

export function showBusy(label: string): void {
  const d = ensure()
  d.querySelector('p')!.textContent = label
  if (!d.open) {
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
  }
}

export function hideBusy(): void {
  if (!dialog) return
  if (typeof dialog.close === 'function' && dialog.open) dialog.close()
  dialog.removeAttribute('open')
}

export function busyShown(): boolean {
  return !!dialog?.open
}
