const foldedKey = 'margin.sidebar-folded'

// On wider screens the sidebar folds into a strip, and stays folded across
// reloads. On narrow ones it is a drawer instead, closed by the same button.
export class SidebarFold {
  constructor(
    private readonly body: HTMLElement,
    fold: HTMLElement,
    unfold: HTMLElement,
    compact: MediaQueryList,
  ) {
    this.set(loadFolded())
    fold.addEventListener('click', () => {
      if (!compact.matches) this.set(true)
    })
    unfold.addEventListener('click', () => this.set(false))
  }

  private set(folded: boolean) {
    this.body.classList.toggle('sidebar-folded', folded)
    try {
      localStorage.setItem(foldedKey, String(folded))
    } catch {
      // not persisted
    }
  }
}

// Fold state is a per-browser convenience; storage may be unavailable.
function loadFolded(): boolean {
  try {
    return localStorage.getItem(foldedKey) === 'true'
  } catch {
    return false
  }
}
