// What the open document is compared with: the version last read in margin
// (unread changes) or the one last committed (uncommitted changes).
//
// Until the reader picks a baseline, the one shown is the first the file
// differs from, preferring unread changes, and new unread changes switch
// to them.

import { splitFrontmatter } from '../markdown/frontmatter'

export type Baseline = 'seen' | 'committed'

export const baselines: Baseline[] = ['seen', 'committed']

export type Fetch = (path: string) => Promise<string | undefined>

export interface ComparisonListener {
  // The body to show changes against; undefined shows none.
  compare(body: string | undefined): void
  // Which baselines exist for the file, and which one is in use.
  baselines(available: Baseline[], current: Baseline): void
}

export class Comparison {
  private versions: Partial<Record<Baseline, string>> = {}
  private chosen?: Baseline
  private picked = false // by the reader
  private loading = 0

  constructor(
    readonly path: string,
    private readonly fetchers: Record<Baseline, Fetch>,
    private readonly listener: ComparisonListener,
  ) {}

  get baseline(): Baseline {
    return this.chosen ?? 'seen'
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
    const differs = (b: Baseline) => this.versions[b] !== undefined && this.versions[b] !== content
    if (!this.picked && (this.chosen === undefined || differs('seen'))) this.chosen = baselines.find(differs)
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
    this.listener.baselines(
      baselines.filter((b) => this.versions[b] !== undefined),
      this.baseline,
    )
  }
}
