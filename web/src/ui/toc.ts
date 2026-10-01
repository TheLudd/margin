import { debounce } from '../sync'
import { h } from './dom'

// A table of contents built from the document's headings, so no document
// needs a [[toc]] marker. It follows edits and highlights the heading in view.
export class Toc {
  private headings: HTMLElement[] = []
  private links: HTMLElement[] = []

  constructor(
    private readonly root: HTMLElement,
    private readonly content: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {
    new MutationObserver(debounce(() => this.build(), 150)).observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scroller.addEventListener('scroll', debounce(() => this.highlight(), 50), { passive: true })
  }

  build() {
    this.headings = [...this.content.querySelectorAll<HTMLElement>('.ProseMirror > :is(h1, h2, h3, h4)')]
    this.links = this.headings.map((heading) => {
      const link = h('a', { href: '#', class: `level-${heading.tagName[1]}` }, heading.textContent || '…')
      link.addEventListener('click', (event) => {
        event.preventDefault()
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return link
    })
    this.root.replaceChildren(...(this.links.length ? [h('h2', {}, 'Contents'), ...this.links] : []))
    this.root.hidden = this.links.length === 0
    this.highlight()
  }

  private highlight() {
    const top = this.scroller.getBoundingClientRect().top + 120
    const { scrollTop, scrollHeight, clientHeight } = this.scroller
    let active = 0
    this.headings.forEach((heading, i) => {
      if (heading.getBoundingClientRect().top <= top) active = i
    })
    // At the bottom the last headings can't reach the top; the last one wins.
    if (scrollTop + clientHeight >= scrollHeight - 2) active = this.headings.length - 1
    this.links.forEach((link, i) => link.classList.toggle('active', i === active))
    this.links[active]?.scrollIntoView({ block: 'nearest' })
  }
}
