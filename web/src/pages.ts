// The home and missing pages (L-33).
import { el } from './shell'

export function renderHome(container: HTMLElement): void {
  container.replaceChildren(
    el('h1', { text: 'margin' }),
    el('p', { text: 'Pick a file in the sidebar, or press ' }, el('kbd', { text: 'Ctrl K' }), ' to find one.'),
  )
}

export function renderMissing(container: HTMLElement, path: string): void {
  container.replaceChildren(el('h1', { text: 'Not found' }), el('p', { text: `There is no file at ${path}.` }))
}
