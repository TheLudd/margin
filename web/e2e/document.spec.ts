// Section 6 as seen from the browser: the document (D), with the F-04 header
// check and the W-04 and W-05 copies checks.
import { expect, open, test } from './fixtures'

const sample = `# Title

A paragraph with **bold** and \`code\`.

## Second

- [ ] task one
- [x] task two

\`\`\`js
const x = 1
\`\`\`

### Third

Last words.
`

test.describe('document', () => {
  test('D-01, D-14, F-04: a file opens for reading with its name as the tab title and the label in the header; selecting text changes nothing', async ({ page, margin }) => {
    margin.write('docs/sample.md', sample)
    await open(page, margin, 'docs/sample.md')
    await expect(page).toHaveTitle('sample.md')
    await expect(page.locator('.doc-header .file-label .name')).toHaveText('sample.md')
    await expect(page.locator('.doc-header .file-label .dir')).toHaveText('docs')
    const editor = page.locator('.ProseMirror')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(editor.locator('h1')).toHaveText('Title')
    await page.locator('.ProseMirror > p').first().selectText()
    await page.keyboard.type('zzz')
    await page.waitForTimeout(1500)
    expect(margin.read('docs/sample.md')).toBe(sample)
    await expect(page.locator('.doc-header .status')).toHaveText('saved')
  })

  test('D-01, D-02, K: E starts editing where the click was, Esc stops it, the page says so while editing', async ({ page, margin }) => {
    margin.write('a.md', sample)
    await open(page, margin, 'a.md')
    const editor = page.locator('.ProseMirror')
    await page.locator('.ProseMirror > p', { hasText: 'Last words' }).click()
    await page.keyboard.press('e')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect(page.locator('.doc-header .edit')).toHaveText('editing')
    await expect(page.locator('.doc-header .edit')).toHaveClass(/active/)
    await expect(page.locator('.ProseMirror .cursor-block')).toHaveText('Last words.')
    await expect(editor).toHaveCSS('caret-color', 'rgb(255, 43, 214)')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.doc-header .edit')).toHaveText('edit')
    await expect(page.locator('.ProseMirror .cursor-block')).toHaveCount(0)
    await page.locator('.doc-header .edit').click()
    await expect(editor).toHaveAttribute('contenteditable', 'true')
  })

  test('D-01: E is ignored while typing in an input', async ({ page, margin }) => {
    margin.write('a.md', sample)
    await open(page, margin, 'a.md')
    await page.keyboard.press('Control+k')
    await page.locator('#finder input').pressSequentially('e')
    await expect(page.locator('#finder input')).toHaveValue('e')
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await page.keyboard.press('Escape')
  })

  test('D-03, D-04: edits autosave about a second after the last edit, and a one-word edit changes one block', async ({ page, margin }) => {
    const source = '# Title\n\nFirst   paragraph   with odd spacing.\n\n+ plus list\n+ second\n\nLast paragraph.\n'
    margin.write('a.md', source)
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > p', { hasText: 'Last paragraph' }).click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited.')
    await expect(page.locator('.doc-header .status')).toHaveText('unsaved')
    await page.waitForTimeout(500)
    expect(margin.read('a.md')).toBe(source)
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe('# Title\n\nFirst   paragraph   with odd spacing.\n\n+ plus list\n+ second\n\nLast paragraph. Edited.\n')
  })

  test('D-05: an unchanged save reproduces the file byte for byte', async ({ page, margin }) => {
    const source = '---\ntitle: x\n---\n\n# Title\n\nSee [the docs][ref] and ![alt](img.png).\n\n[ref]: https://example.com\n\n+ a\n+ b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n'
    margin.write('a.md', source)
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > h1').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe(source)
  })

  test('D-06, J-06: frontmatter is a folded panel, reattached byte for byte, growing to its text, editable in edit mode', async ({ page, margin }) => {
    const source = '---\ntitle:   Hello\ntags: [a, b]\n---\n# Doc\n\ntext\n'
    margin.write('a.md', source)
    await open(page, margin, 'a.md')
    const panel = page.locator('.frontmatter')
    await expect(panel).toBeVisible()
    await expect(panel).not.toHaveAttribute('open')
    await expect(panel.locator('summary')).toHaveText('frontmatter')
    await panel.locator('summary').click()
    const area = panel.locator('textarea')
    await expect(area).toHaveValue('title:   Hello\ntags: [a, b]')
    await expect(area).toHaveJSProperty('readOnly', true)
    const fits = await area.evaluate((t) => t.clientHeight >= t.scrollHeight && getComputedStyle(t).overflowY === 'hidden')
    expect(fits).toBe(true)
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await expect(area).toHaveJSProperty('readOnly', false)
    await area.fill('title:   Hello\ntags: [a, b]\nmore: 1\nlines: 2')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe('---\ntitle:   Hello\ntags: [a, b]\nmore: 1\nlines: 2\n---\n# Doc\n\ntext\n')
    const grown = await area.evaluate((t) => t.clientHeight >= t.scrollHeight)
    expect(grown).toBe(true)
  })

  test('D-07: clicking a task checkbox is an edit', async ({ page, margin }) => {
    margin.write('a.md', '# Tasks\n\n- [ ] one\n- [x] two\n')
    await open(page, margin, 'a.md')
    const boxes = page.locator('.ProseMirror li[data-item-type=task] input')
    await expect(boxes).toHaveCount(2)
    await boxes.first().click()
    await expect(boxes.first()).toBeChecked()
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe('# Tasks\n\n- [x] one\n- [x] two\n')
  })

  test('D-08: mermaid blocks render as diagrams; in edit mode a click opens the source with a live preview', async ({ page, margin }) => {
    margin.write('a.md', '# Diagram\n\n```mermaid\ngraph TD\n  A --> B\n```\n')
    await open(page, margin, 'a.md')
    const block = page.locator('.code-block.mermaid')
    await expect(block.locator('.preview svg')).toBeVisible({ timeout: 15_000 })
    await expect(block.locator('pre')).toBeHidden()
    await page.locator('.ProseMirror > h1').click()
    await page.keyboard.press('e')
    await expect(block.locator('pre')).toBeHidden()
    await block.locator('.preview').click()
    await expect(block.locator('pre')).toBeVisible()
    await expect(block.locator('.preview svg')).toBeVisible()
    await block.locator('pre code').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  B --> C')
    await expect(block.locator('.preview svg')).toContainText('C', { timeout: 10_000 })
  })

  test('D-09: code blocks are editable once editing starts', async ({ page, margin }) => {
    margin.write('a.md', '# Code\n\n```js\nconst x = 1\n```\n')
    await open(page, margin, 'a.md')
    const code = page.locator('.code-block pre code')
    await expect(code).toHaveText('const x = 1')
    await code.click()
    await page.keyboard.press('e')
    await code.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' + 2')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe('# Code\n\n```js\nconst x = 1 + 2\n```\n')
  })

  test('D-18: code blocks in a known language are highlighted in the theme, also as you type; untagged ones stay plain', async ({ page, margin }) => {
    margin.write('a.md', '# Code\n\n```xml\n<a href="x"/>\n```\n\n```\n<a href="x"/>\n```\n')
    await open(page, margin, 'a.md')
    const [xml, plain] = [page.locator('.code-block').nth(0), page.locator('.code-block').nth(1)]
    await expect(xml.locator('.hljs-name')).toHaveCSS('color', 'rgb(255, 43, 214)')
    await expect(xml.locator('.hljs-attr')).toHaveCSS('color', 'rgb(0, 229, 255)')
    await expect(xml.locator('.hljs-string')).toHaveCSS('color', 'rgb(92, 255, 168)')
    await expect(plain.locator('[class*="hljs-"]')).toHaveCount(0)
    await xml.locator('pre code').click()
    await page.keyboard.press('e')
    await xml.locator('pre code').click()
    await page.keyboard.press('End')
    await page.keyboard.type('<!-- note -->')
    await expect(xml.locator('.hljs-comment')).toHaveText('<!-- note -->')
  })

  test('D-10: the contents panel follows h1–h4, highlights the heading in view, scrolls on click and puts the anchor in the URL', async ({ page, margin }) => {
    let body = '# Top\n\n'
    for (let i = 1; i <= 6; i++) body += `## Section ${i}\n\n` + 'Lorem ipsum dolor sit amet.\n\n'.repeat(12) + `### Sub ${i}\n\n#### Deep ${i}\n\n##### Five ${i}\n\ntext\n\n`
    margin.write('a.md', body)
    await open(page, margin, 'a.md')
    const toc = page.locator('#toc')
    await expect(toc).toBeVisible()
    await expect(toc.locator('a.level-2')).toHaveCount(6)
    await expect(toc.locator('a.level-4')).toHaveCount(6)
    await expect(toc.locator('a.level-5')).toHaveCount(0)
    await expect(toc.locator('a.active')).toHaveText('Top')
    await toc.locator('a', { hasText: 'Section 4' }).click()
    await expect(page).toHaveURL(/#section-4$/)
    await expect(toc.locator('a.active')).toHaveText('Section 4')
    const heading = page.locator('.ProseMirror > h2', { hasText: 'Section 4' })
    const box = (await heading.boundingBox())!
    const mainBox = (await page.locator('#main').boundingBox())!
    expect(box.y - mainBox.y).toBeGreaterThanOrEqual(40)
    expect(box.y - mainBox.y).toBeLessThan(120)
    await page.locator('#main').evaluate((m) => m.scrollTo({ top: m.scrollHeight }))
    await expect(toc.locator('a.active')).toHaveText('Deep 6')
    await expect(toc.locator('a.active')).toBeInViewport()
    await page.reload()
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'document')
    await expect(toc.locator('a.active')).toHaveText('Section 4')
  })

  test('D-10: the contents follow edits and are never part of the document; an existing [[toc]] is kept on save', async ({ page, margin }) => {
    const source = '# One\n\n[[toc]]\n\n## Two\n\ntext\n'
    margin.write('a.md', source)
    await open(page, margin, 'a.md')
    const toc = page.locator('#toc')
    await expect(toc.locator('a')).toHaveCount(2)
    await expect(page.locator('.ProseMirror nav, .ProseMirror .toc')).toHaveCount(0)
    await page.locator('.ProseMirror > p', { hasText: 'text' }).click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('## Three')
    await expect(toc.locator('a')).toHaveCount(3)
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe('# One\n\n[[toc]]\n\n## Two\n\ntext\n\n## Three\n')
  })

  test('D-10: without headings there is no contents column', async ({ page, margin }) => {
    margin.write('a.md', 'Just a paragraph.\n')
    await open(page, margin, 'a.md')
    await expect(page.locator('#toc')).toBeHidden()
    const columns = await page.evaluate(() => getComputedStyle(document.body).gridTemplateColumns.split(' ').length)
    expect(columns).toBe(2)
  })

  test('D-11, L-08: code blocks and tables keep to the text width unless wider, then grow evenly to a gutter and scroll beyond', async ({ page, margin }) => {
    const wide = 'x'.repeat(400)
    margin.write('a.md', `# W\n\nShort text.\n\n\`\`\`\nshort\n\`\`\`\n\n\`\`\`\n${wide}\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n| ${wide} | ${wide} |\n|---|---|\n| 1 | 2 |\n`)
    await open(page, margin, 'a.md')
    const text = (await page.locator('.ProseMirror > p').first().boundingBox())!
    const narrowCode = (await page.locator('.code-block').nth(0).boundingBox())!
    const wideCode = (await page.locator('.code-block').nth(1).boundingBox())!
    const narrowTable = (await page.locator('.table-block table').nth(0).boundingBox())!
    const wideTable = (await page.locator('.table-block').nth(1).boundingBox())!
    const main = (await page.locator('#main').boundingBox())!
    expect(Math.abs(narrowCode.x - text.x)).toBeLessThan(2)
    expect(Math.abs(narrowCode.width - text.width)).toBeLessThan(2)
    expect(wideCode.width).toBeGreaterThan(text.width + 20)
    expect(wideCode.x).toBeGreaterThanOrEqual(main.x + 24 - 1)
    expect(wideCode.x + wideCode.width).toBeLessThanOrEqual(main.x + main.width + 1 - 24 + 8)
    const centeredOnText = Math.abs(wideCode.x + wideCode.width / 2 - (text.x + text.width / 2))
    expect(centeredOnText).toBeLessThan(2)
    const scrolls = await page.locator('.code-block pre').nth(1).evaluate((p) => p.scrollWidth > p.clientWidth)
    expect(scrolls).toBe(true)
    expect(narrowTable.width).toBeLessThan(text.width)
    expect(wideTable.width).toBeGreaterThan(text.width + 20)
    const tableScrolls = await page.locator('.table-block .table-wrapper').nth(1).evaluate((w) => w.scrollWidth > w.clientWidth)
    expect(tableScrolls).toBe(true)
  })

  test('D-12: long inline code stays on its line and wraps as text', async ({ page, margin }) => {
    const long = 'a'.repeat(120)
    margin.write('a.md', `# C\n\nBefore \`${long}\` after.\n`)
    await open(page, margin, 'a.md')
    const code = page.locator('.ProseMirror > p code')
    await expect(code).toHaveCSS('display', 'inline')
    const rects = await code.evaluate((c) => c.getClientRects().length)
    expect(rects).toBeGreaterThan(1)
  })

  test('D-13, K: Ctrl click on a link to a markdown file opens it in margin; other links open a new tab', async ({ page, margin, context }) => {
    margin.write('docs/a.md', '# A\n\nSee [b](b.md) and [up](../top.md) and [web](https://example.com/).\n')
    margin.write('docs/b.md', '# B\n')
    margin.write('top.md', '# Top\n')
    await context.route('https://example.com/**', (route) => route.fulfill({ body: '<title>example</title>', contentType: 'text/html' }))
    await open(page, margin, 'docs/a.md')
    await page.locator('.ProseMirror a', { hasText: /^b$/ }).click({ modifiers: ['Control'] })
    await expect(page).toHaveURL(margin.url + '/code/docs/b.md')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('B')
    await page.goBack()
    await expect(page.locator('.ProseMirror > h1')).toHaveText('A')
    await page.locator('.ProseMirror a', { hasText: 'up' }).click({ modifiers: ['Control'] })
    await expect(page).toHaveURL(margin.url + '/code/top.md')
    await page.goBack()
    await expect(page.locator('.ProseMirror > h1')).toHaveText('A')
    const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('.ProseMirror a', { hasText: 'web' }).click()])
    await popup.waitForLoadState()
    expect(popup.url()).toBe('https://example.com/')
    await popup.close()
    await expect(page).toHaveURL(margin.url + '/code/docs/a.md')
  })

  test('D-15: a deleted or moved file shows a banner and edits are not saved', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\ntext\n')
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    margin.rename('a.md', 'moved.md')
    await expect(page.locator('.banner')).toBeVisible()
    await expect(page.locator('.banner')).toContainText('deleted or moved')
    await expect(page.locator('.doc-header .status')).toHaveText('deleted')
    await page.keyboard.type('more')
    await page.waitForTimeout(1500)
    expect(margin.exists('a.md')).toBe(false)
    expect(margin.read('moved.md')).toBe('# A\n\ntext\n')
  })

  test('D-16: images without a title are rendered, $ in prose is prose, and alt text is never written into', async ({ page, margin }) => {
    const source = '# I\n\n![a picture](pic.png)\n\nCosts $5 and $x$ here.\n'
    margin.write('a.md', source)
    await open(page, margin, 'a.md')
    const img = page.locator('.ProseMirror img[src]')
    await expect(img).toHaveAttribute('src', 'pic.png')
    await expect(img).toHaveAttribute('alt', 'a picture')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('Costs $5 and $x$ here.')
    await expect(page.locator('.ProseMirror .katex, .ProseMirror .math')).toHaveCount(0)
    await page.locator('.ProseMirror > h1').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    expect(margin.read('a.md')).toBe('# I!\n\n![a picture](pic.png)\n\nCosts $5 and $x$ here.\n')
  })

  test('D-17: switching files while an edit is pending saves it first', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\ntext\n')
    margin.write('b.md', '# B\n')
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' more')
    await page.locator('#sidebar details[data-project="code"] summary').click()
    await page.locator('#sidebar a[href="/code/b.md"]').click()
    await expect(page.locator('.ProseMirror > h1')).toHaveText('B')
    expect(margin.read('a.md')).toBe('# A\n\ntext more\n')
  })

  test('W-04, W-05: the header lists every copy and choosing one opens it; a URL opens exactly that copy', async ({ page, margin }) => {
    margin.repo('foo/main', { 'readme.md': '# Main copy\n' })
    margin.git('foo/main', 'worktree', 'add', '-q', '-b', 'feat', '../feat')
    margin.write('foo/feat/readme.md', '# Feat copy\n')
    await open(page, margin, 'foo/main/readme.md')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Main copy')
    const select = page.locator('.doc-header .worktree')
    await expect(select).toBeVisible()
    await expect(select.locator('option')).toHaveCount(2)
    await expect(select.locator('option').nth(0)).toHaveText('main · main')
    await expect(select.locator('option').nth(1)).toContainText('feat · changed')
    await select.selectOption('/code/foo/feat/readme.md')
    await expect(page).toHaveURL(margin.url + '/code/foo/feat/readme.md')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Feat copy')
    await expect(select).toHaveValue('/code/foo/feat/readme.md')
    await page.goto(margin.url + '/code/foo/main/readme.md')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Main copy')
  })

  test('CH-11: a file in git shows committed, uncommitted or untracked; files outside git show no badge', async ({ page, margin }) => {
    margin.repo('repo', { 'c.md': '# C\n' })
    margin.write('repo/u.md', '# U\n')
    margin.write('plain.md', '# P\n')
    await open(page, margin, 'repo/c.md')
    await expect(page.locator('.doc-header .commit')).toHaveText('committed')
    await open(page, margin, 'repo/u.md')
    await expect(page.locator('.doc-header .commit')).toHaveText('untracked')
    await open(page, margin, 'plain.md')
    await expect(page.locator('.doc-header .commit')).toBeHidden()
    margin.write('repo/c.md', '# C changed\n')
    await open(page, margin, 'repo/c.md')
    await expect(page.locator('.doc-header .commit')).toHaveText('uncommitted')
  })

  test('T-07: the script loaded before any document is opened is under 300KB', async ({ page, margin }) => {
    margin.write('a.md', '# A\n')
    let bytes = 0
    page.on('response', async (res) => {
      if (res.request().resourceType() === 'script' || res.url().endsWith('.js')) {
        const body = await res.body().catch(() => Buffer.alloc(0))
        bytes += body.length
      }
    })
    await page.goto(margin.url + '/')
    await expect(page.locator('#sidebar a[href="/code/a.md"]')).toHaveCount(1)
    await page.waitForTimeout(300)
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThan(300 * 1024)
  })
})
