import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { it } from 'vitest'
import { createEditor } from '../src/editor'
import { splitFrontmatter } from '../src/frontmatter'
import { assemble, splitOriginal } from '../src/preserve'

function list(root: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue
    const abs = path.join(root, e.name)
    if (e.isDirectory()) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      list(abs, out)
    } else if (e.isFile() && e.name.endsWith('.md')) out.push(abs)
  }
  return out
}

it('mem', async () => {
  const log = fs.openSync(process.env.MEMLOG!, 'w')
  const files = list(path.join(os.homedir(), 'code'))
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
  for (let i = 0; i < files.length; i++) {
    const source = fs.readFileSync(files[i], 'utf8')
    const t0 = Date.now()
    fs.writeSync(log, `${i} ${source.length} ${files[i]}\n`)
    try {
      const split = splitFrontmatter(source)
      const originals = splitOriginal(split.body, tools)
      const doc = editor.parse(split.body)
      const current: { norm: string }[] = []
      doc.forEach((n) => current.push({ norm: editor.serialize(n) }))
      assemble(split.body, originals, current)
    } catch (err) {
      fs.writeSync(log, `  ERR ${err instanceof Error ? err.message.slice(0, 100) : err}\n`)
    }
    const ms = Date.now() - t0
    if (ms > 500) fs.writeSync(log, `  SLOW ${ms}ms heap ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB\n`)
  }
  fs.writeSync(log, 'DONE\n')
  await editor.destroy()
}, 1_800_000)
