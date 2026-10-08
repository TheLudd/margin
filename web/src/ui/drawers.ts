// On narrow screens the sidebar and the table of contents slide over the
// document, one at a time. Following a link in one, tapping beside it or Esc
// closes it again.
export class Drawers {
  constructor(
    private readonly body: HTMLElement,
    drawers: Record<string, { el: HTMLElement; toggle: HTMLElement }>,
    scrim: HTMLElement,
  ) {
    for (const [name, { el, toggle }] of Object.entries(drawers)) {
      toggle.addEventListener('click', () => this.show(this.body.dataset.drawer === name ? undefined : name))
      el.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('a, button.find')) this.show(undefined)
      })
    }
    scrim.addEventListener('click', () => this.show(undefined))
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.body.dataset.drawer) this.show(undefined)
    })
  }

  private show(name: string | undefined) {
    if (name) this.body.dataset.drawer = name
    else delete this.body.dataset.drawer
  }
}
