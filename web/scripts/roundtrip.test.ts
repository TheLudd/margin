// D-05, T-06: the round-trip corpus. Every .md file under ~/code (gitignored
// ones, .git and node_modules left out) is opened and saved unchanged; the
// files an unchanged save would alter are reported.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEditor } from '../src/editor'
import { joinFrontmatter, splitFrontmatter } from '../src/frontmatter'
import { assemble, splitOriginal } from '../src/preserve'

const corpus = process.env.MARGIN_CORPUS ?? path.join(os.homedir(), 'code')

function listFiles(root: string): string[] {
  const out: string[] = []
  const repos = new Map<string, Set<string>>()
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue
        walk(abs)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(abs)
      }
    }
  }
  walk(root)
  // Leave out what git ignores, per repository.
  return out.filter((f) => {
    const repo = findRepo(path.dirname(f))
    if (!repo) return true
    let ignored = repos.get(repo)
    if (!ignored) {
      ignored = new Set()
      try {
        const res = execFileSync('git', ['-C', repo, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
        for (const rel of res.split('\0')) if (rel) ignored.add(path.join(repo, rel))
      } catch {
        // Not a repository after all.
      }
      repos.set(repo, ignored)
    }
    return !ignored.has(f)
  })
}

function findRepo(dir: string): string | null {
  let d = dir
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    const parent = path.dirname(d)
    if (parent === d) return null
    d = parent
  }
}

describe('round trip', () => {
  it('D-05, T-06: an unchanged save reproduces at least all but three files of the corpus', async () => {
    const files = listFiles(corpus)
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await createEditor(root, '', { onEdit() {}, onTransaction() {} })
    const tools = {
      blocks: (s: string) => editor.blocks(s),
      norms: (md: string) => {
        const doc = editor.parse(md)
        const out: string[] = []
        doc.forEach((n) => out.push(editor.serialize(n)))
        return out
      },
    }
    const failures: string[] = []
    let total = 0
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      total++
      try {
        const split = splitFrontmatter(source)
        const originals = splitOriginal(split.body, tools)
        const doc = editor.parse(split.body)
        const current: { norm: string }[] = []
        doc.forEach((n) => current.push({ norm: editor.serialize(n) }))
        const out = joinFrontmatter(split, split.text, assemble(split.body, originals, current))
        if (out !== source) failures.push(file)
      } catch (err) {
        failures.push(`${file} (${err instanceof Error ? err.message : err})`)
      }
    }
    console.log(`round trip: ${total - failures.length} of ${total} files reproduced byte for byte`)
    for (const f of failures) console.log('  differs: ' + f)
    expect(failures.length).toBeLessThanOrEqual(3)
    await editor.destroy()
  }, 600_000)
})
