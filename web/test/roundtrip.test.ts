// Loads every markdown file under MARGIN_CORPUS (default ~/code) into the
// editor and reports the files that saving unchanged would not reproduce
// exactly. Slow and machine-specific, so it runs separately as a report:
// `pnpm roundtrip`.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { createEditor } from '../src/editor/editor'
import { splitFrontmatter } from '../src/markdown/frontmatter'
import { preserveSource } from '../src/markdown/preserve-source'

const root = process.env.MARGIN_CORPUS ?? join(homedir(), 'code')
const skipped = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', 'target', '.nx', '.venv'])

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !skipped.has(entry.name)) yield* markdownFiles(join(dir, entry.name))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) yield join(dir, entry.name)
  }
}

function uniqueFiles(): Map<string, string> {
  const byContent = new Map<string, string>()
  for (const path of markdownFiles(root)) {
    const content = readFileSync(path, 'utf8')
    const hash = createHash('sha1').update(content).digest('hex')
    if (!byContent.has(hash)) byContent.set(hash, path)
  }
  return byContent
}

test('round-trip report', { timeout: 600_000 }, async () => {
  const files = [...uniqueFiles().values()]
  let rawIdentical = 0
  const failures: string[] = []

  const element = document.createElement('div')
  document.body.append(element)
  const editor = await createEditor(element, '')

  for (const path of files) {
    const original = readFileSync(path, 'utf8')
    const { body } = splitFrontmatter(original)
    editor.replace(body)
    const serialized = editor.markdown()

    if (serialized === body) rawIdentical++
    if (preserveSource(body, serialized) !== body) failures.push(path)
  }

  await editor.destroy()
  const report = [
    `files: ${files.length}`,
    `identical without preserveSource: ${rawIdentical}`,
    `failing with preserveSource: ${failures.length}`,
    ...failures,
  ].join('\n')
  writeFileSync(process.env.MARGIN_REPORT ?? 'roundtrip-report.txt', report + '\n')
  console.log(report)
})
