// The Playwright harness (T-04): every test gets its own margin, started
// from the built binary over a temp home with a temp root, config and state.
import { test as base, expect, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = path.dirname(fileURLToPath(import.meta.url))
const binary = path.resolve(here, '..', '..', 'margin')

export interface StartOptions {
  /** Write a config with a root named code at ~/code (default true). */
  config?: boolean | object
  /** Extra flags for the binary. */
  flags?: string[]
  /** Reuse an existing home folder (for restarts). */
  home?: string
  binary?: string
}

export class Margin {
  url = ''
  port = 0
  private proc: ChildProcess | null = null
  readonly configFile: string
  readonly stateDir: string
  readonly root: string
  stderr = ''

  constructor(readonly home: string) {
    this.configFile = path.join(home, '.config', 'margin', 'config.json')
    this.stateDir = path.join(home, '.local', 'state', 'margin')
    this.root = path.join(home, 'code')
  }

  static async start(opts: StartOptions = {}): Promise<Margin> {
    const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'margin-e2e-'))
    const m = new Margin(home)
    fs.mkdirSync(m.root, { recursive: true })
    if (opts.config !== false && !opts.home) {
      const cfg = typeof opts.config === 'object' ? opts.config : { roots: [{ name: 'code', path: '~/code' }] }
      m.writeConfig(cfg)
    }
    await m.launch(opts.flags ?? [], opts.binary ?? binary)
    return m
  }

  writeConfig(cfg: object): void {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true })
    fs.writeFileSync(this.configFile, JSON.stringify(cfg, null, 2) + '\n')
  }

  async launch(flags: string[], bin = binary, port = 0): Promise<void> {
    const args = ['-port', String(port), '-config', this.configFile, '-state', this.stateDir, ...flags]
    const proc = spawn(bin, args, {
      env: { ...process.env, HOME: this.home, XDG_CONFIG_HOME: '', XDG_STATE_HOME: '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    this.proc = proc
    this.stderr = ''
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('margin did not start: ' + this.stderr)), 10_000)
      proc.stderr!.on('data', (chunk: Buffer) => {
        this.stderr += chunk.toString()
        const m = /listening on http:\/\/([\d.]+):(\d+)/.exec(this.stderr)
        if (m) {
          clearTimeout(timer)
          this.port = Number(m[2])
          this.url = `http://localhost:${this.port}`
          resolve()
        }
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`margin exited with ${code}: ${this.stderr}`))
      })
    })
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve())
      proc.kill('SIGTERM')
      setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 3000)
    })
  }

  /** Stops and starts again on the same port, as a service restart would. */
  async restart(flags: string[] = [], bin = binary): Promise<void> {
    const port = this.port
    await this.stop()
    await this.launch(flags, bin, port)
  }

  async cleanup(): Promise<void> {
    await this.stop()
    fs.rmSync(this.home, { recursive: true, force: true })
  }

  /** Writes a file under the root, in place. */
  write(rel: string, content: string): string {
    const abs = path.join(this.root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    return abs
  }

  /** Writes a file under the root by writing a temp file and renaming it over. */
  writeAtomic(rel: string, content: string): string {
    const abs = path.join(this.root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = abs + '.tmp-' + process.pid
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, abs)
    return abs
  }

  read(rel: string): string {
    return fs.readFileSync(path.join(this.root, rel), 'utf8')
  }

  exists(rel: string): boolean {
    return fs.existsSync(path.join(this.root, rel))
  }

  remove(rel: string): void {
    fs.rmSync(path.join(this.root, rel), { recursive: true, force: true })
  }

  rename(from: string, to: string): void {
    fs.renameSync(path.join(this.root, from), path.join(this.root, to))
  }

  touch(rel: string, when: Date): void {
    fs.utimesSync(path.join(this.root, rel), when, when)
  }

  /** Runs git in a folder under the root. */
  git(rel: string, ...args: string[]): string {
    const res = spawnSync('git', ['-C', path.join(this.root, rel), ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
      encoding: 'utf8',
    })
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
    return res.stdout.trim()
  }

  /** Makes a repository at rel with the given files committed. */
  repo(rel: string, files: Record<string, string>): void {
    fs.mkdirSync(path.join(this.root, rel), { recursive: true })
    this.git(rel, 'init', '-q', '-b', 'main')
    for (const [name, content] of Object.entries(files)) this.write(path.join(rel, name), content)
    this.git(rel, 'add', '.')
    this.git(rel, 'commit', '-q', '-m', 'init')
  }

  /** A margin path for a file under the root. */
  path(rel: string): string {
    return '/code/' + rel
  }
}

export const test = base.extend<{ margin: Margin }>({
  margin: async ({}, use) => {
    const m = await Margin.start()
    await use(m)
    await m.cleanup()
  },
})

export { expect }

/** Opens a document and waits for it to show. */
export async function open(page: Page, margin: Margin, rel: string): Promise<void> {
  await page.goto(margin.url + margin.path(rel))
  await expect(page.locator('#main')).toHaveAttribute('data-view', 'document')
}

/** The sidebar link for a path. */
export function sidebarLink(page: Page, mpath: string) {
  return page.locator(`#sidebar a[href="${mpath}"]`)
}

export function older(page: Page) {
  return page.locator('#sidebar details[data-section="older"]')
}

export function recent(page: Page) {
  return page.locator('#sidebar details[data-section="recent"]')
}
