// What the open document is compared with: the version last read in margin
// (unread changes) or the one last committed (uncommitted changes).
//
// Until the reader picks a baseline, the one shown is the first the file
// differs from, preferring unread changes, and new unread changes switch
// to them. Once uncommitted changes are committed, unread ones show again.
//
// A file the reader edits by hand, in an editor of their own, has no unread
// changes: they are the reader's. Its uncommitted changes show only when
// asked for.

import { splitFrontmatter } from '../markdown/frontmatter'

export type Baseline = 'seen' | 'committed'

export const baselines: Baseline[] = ['seen', 'committed']

export type Fetch = (path: string) => Promise<string | undefined>

export interface ComparisonListener {
  // The body to show changes against; undefined shows none.
  compare(body: string | undefined): void
  // The baseline in use, whether the file is as committed (undefined when
  // it has no committed version), and whether it is edited by hand.
  state(current: Baseline, committed: boolean | undefined, manual: boolean): void
}

export class Comparison {
  private versions: Partial<Record<Baseline, string>> = {}
  private chosen?: Baseline
  private picked = false // by the reader
  private loading = 0
  private content = '' // the file as shown

  constructor(
    readonly path: string,
    private readonly fetchers: Record<Baseline, Fetch>,
    private readonly listener: ComparisonListener,
    private _manual = false,
  ) {}

  get baseline(): Baseline {
    return this.chosen ?? 'seen'
  }

  // Whether the reader edits the file by hand.
  get manual(): boolean {
    return this._manual
  }

  setManual(manual: boolean) {
    this._manual = manual
  }

  // Fetches the baselines again. content is the file as shown, used to pick
  // the first baseline.
  async load(content: string) {
    const token = ++this.loading
    let fetched: (string | undefined)[]
    try {
      fetched = await Promise.all(baselines.map((b) => this.fetchers[b](this.path)))
    } catch {
      return // the service is unreachable; the next load catches up
    }
    if (token !== this.loading) return
    this.versions = Object.fromEntries(baselines.map((b, i) => [b, fetched[i]]))
    this.content = content
    const differs = (b: Baseline) => this.versions[b] !== undefined && this.versions[b] !== content
    if (this.manual && !this.picked) {
      this.chosen = 'seen'
    } else if (this.chosen === 'committed' && !differs('committed')) {
      this.chosen = 'seen'
      this.picked = false
    } else if (!this.picked && (this.chosen === undefined || differs('seen'))) {
      this.chosen = baselines.find(differs)
    }
    this.emit()
  }

  use(baseline: Baseline) {
    this.chosen = baseline
    this.picked = true
    this.emit()
  }

  private emit() {
    const version = this.versions[this.baseline]
    this.listener.compare(version === undefined ? undefined : splitFrontmatter(version).body)
    const committed = this.versions.committed
    this.listener.state(this.baseline, committed === undefined ? undefined : committed === this.content, this.manual)
  }
}
