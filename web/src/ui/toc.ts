import { debounce } from '../sync'
import { h } from './dom'
import { slugs } from './slugs'

// A table of contents built from the document's headings, so no document
// needs a [[toc]] marker. It follows edits and highlights the heading in view.
// Following a heading puts its anchor in the URL, so a reload returns there.
export class Toc {
  private headings: HTMLElement[] = []
  private slugs: string[] = []
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
    this.slugs = slugs(this.headings.map((heading) => heading.textContent ?? ''))
    this.links = this.headings.map((heading, i) => {
      const link = h('a', { href: `#${this.slugs[i]}`, class: `level-${heading.tagName[1]}` }, heading.textContent || '…')
      link.addEventListener('click', (event) => {
        event.preventDefault()
        history.replaceState(null, '', `#${this.slugs[i]}`)
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return link
    })
    this.root.replaceChildren(...(this.links.length ? [h('h2', {}, 'Contents'), ...this.links] : []))
    this.root.hidden = this.links.length === 0
    this.highlight()
  }

  // Scrolls to the heading with that anchor, if there is one.
  reveal(slug: string) {
    this.headings[this.slugs.indexOf(slug)]?.scrollIntoView({ block: 'start' })
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
