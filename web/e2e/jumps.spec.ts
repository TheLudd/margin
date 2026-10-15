// Section 10 as seen from the browser: nothing jumps (J). Each instance
// compares the bounding boxes of neighbours before and after a state change.
import { expect, open, recent, test } from './fixtures'
import type { Locator } from '@playwright/test'

async function boxes(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const n = await locator.count()
  const out = []
  for (let i = 0; i < n; i++) out.push((await locator.nth(i).boundingBox())!)
  return out
}

test.describe('nothing jumps', () => {
  test('J-01: header badges keep their width through every value: stable values dim, changing ones tinted', async ({ page, margin }) => {
    margin.repo('repo', { 'a.md': '# A\n\ntext\n' })
    await open(page, margin, 'repo/a.md')
    const badges = page.locator('.doc-header .badge')
    const before = await boxes(badges)
    const edit = page.locator('.doc-header .badge.edit')
    const status = page.locator('.doc-header .badge.status')
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await expect(edit).toHaveText('editing')
    await page.keyboard.type(' more')
    await expect(status).toHaveText('unsaved')
    expect(await boxes(badges)).toEqual(before)
    await expect(status).toHaveText('saved', { timeout: 5000 })
    await expect(page.locator('.doc-header .badge.commit')).toHaveText('uncommitted')
    expect(await boxes(badges)).toEqual(before)
    await page.locator('.doc-header .badge.manual').click()
    await expect(page.locator('.doc-header .badge.manual')).toHaveClass(/active/)
    expect(await boxes(badges)).toEqual(before)
    const widths = await badges.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
    // uncommitted (11 chars) is the widest, retrying (8) next, editing (7), manual (6).
    expect(widths[2]).toBeGreaterThan(widths[3])
    expect(widths[3]).toBeGreaterThan(widths[0])
    expect(widths[0]).toBeGreaterThan(widths[1])
    for (const b of ['edit', 'manual', 'commit', 'status']) {
      const el = page.locator(`.doc-header .badge.${b}`)
      expect(await el.evaluate((e) => getComputedStyle(e).textAlign)).toBe('center')
      expect(await el.evaluate((e) => getComputedStyle(e).textTransform)).toBe('uppercase')
    }
  })

  test('J-02: the unread mark is drawn in existing padding; marking files read moves nothing', async ({ page, margin }) => {
    for (let i = 0; i < 4; i++) margin.write(`n${i}.md`, `# ${i}\n\ntext\n`)
    for (let i = 0; i < 4; i++) await open(page, margin, `n${i}.md`)
    const entries = recent(page).locator('li.recent-entry')
    await expect(entries).toHaveCount(4)
    const before = await boxes(entries.locator('a, time, .file-label'))
    margin.write('n1.md', '# 1\n\nchanged\n')
    margin.write('n2.md', '# 2\n\nchanged\n')
    await expect(recent(page).locator('a.unread')).toHaveCount(2)
    expect(await boxes(entries.locator('a, time, .file-label'))).toEqual(before)
    await open(page, margin, 'n1.md')
    await page.locator('.doc-header .changes .mark-read').click()
    await expect(recent(page).locator('a.unread')).toHaveCount(1)
    expect(await boxes(entries.locator('a, time, .file-label'))).toEqual(before)
  })

  test('J-03: times and copy counts stay visible beside long file names; the name is cut instead', async ({ page, margin }) => {
    const long = 'a-very-long-file-name-that-goes-on-and-on-and-on-until-it-has-to-be-cut-somewhere.md'
    margin.write(`deep/folder/${long}`, '# L\n')
    margin.repo('wt/main', { [long]: '# W\n' })
    margin.git('wt/main', 'worktree', 'add', '-q', '-b', 'feat', '../feat')
    await open(page, margin, `deep/folder/${long}`)
    const entry = recent(page).locator(`a[href="/code/deep/folder/${long}"]`)
    const sidebar = (await page.locator('#sidebar').boundingBox())!
    const time = (await entry.locator('time').boundingBox())!
    expect(time.x + time.width).toBeLessThanOrEqual(sidebar.x + sidebar.width)
    expect(time.width).toBeGreaterThan(10)
    const cut = await entry.locator('.name').evaluate((n) => n.scrollWidth > n.clientWidth && getComputedStyle(n).textOverflow === 'ellipsis')
    expect(cut).toBe(true)
    const group = page.locator('#sidebar details[data-project=wt]')
    await group.locator('summary').click()
    const copies = (await group.locator('.copies').boundingBox())!
    expect(copies.x + copies.width).toBeLessThanOrEqual(sidebar.x + sidebar.width)
    expect(copies.width).toBeGreaterThan(10)
  })

  test('J-04: the change buttons beside a change stay in reach: they hide only after a delay', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\nParagraph one with words.\n\nParagraph two with words.\n')
    await open(page, margin, 'a.md')
    margin.write('a.md', '# A\n\nParagraph one with words.\n\nParagraph two with other words.\n')
    const block = page.locator('.ProseMirror > p.change-block')
    const controls = page.locator('.ProseMirror .change-controls > span')
    await block.hover()
    await expect(controls).toBeVisible()
    const b = (await block.boundingBox())!
    const c = (await controls.boundingBox())!
    // Cross the gutter slowly: still visible on the way.
    for (let x = b.x; x >= c.x + c.width / 2; x -= 10) {
      await page.mouse.move(x, c.y + 8)
      await page.waitForTimeout(40)
    }
    await expect(controls).toBeVisible()
    await page.mouse.move(c.x + c.width / 2, c.y + 8)
    await page.waitForTimeout(600)
    await expect(controls).toBeVisible()
  })

  test('J-05: the changes controls appear and disappear without moving the badges', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\nParagraph one with words.\n\nParagraph two with words.\n')
    await open(page, margin, 'a.md')
    const badges = page.locator('.doc-header .badges')
    const before = (await badges.boundingBox())!
    margin.write('a.md', '# A\n\nParagraph one with words.\n\nParagraph two with other words.\n')
    await expect(page.locator('.doc-header .changes')).toBeVisible()
    expect(await badges.boundingBox()).toEqual(before)
    await page.locator('.doc-header .changes .mark-read').click()
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    expect(await badges.boundingBox()).toEqual(before)
  })

  test('J-06: the frontmatter panel grows to its text; nothing scrolls inside it', async ({ page, margin }) => {
    const lines = Array.from({ length: 12 }, (_, i) => `key${i}: value ${i}`).join('\n')
    margin.write('a.md', `---\n${lines}\n---\n# A\n\ntext\n`)
    await open(page, margin, 'a.md')
    const panel = page.locator('.frontmatter')
    const article = page.locator('article')
    const editorBefore = (await page.locator('.ProseMirror').boundingBox())!
    await panel.locator('summary').click()
    const area = panel.locator('textarea')
    const fits = await area.evaluate((t) => ({ overflow: getComputedStyle(t).overflowY, fits: t.clientHeight >= t.scrollHeight, rows: t.clientHeight }))
    expect(fits.overflow).toBe('hidden')
    expect(fits.fits).toBe(true)
    expect(fits.rows).toBeGreaterThan(12 * 14)
    const editorAfter = (await page.locator('.ProseMirror').boundingBox())!
    expect(editorAfter.y).toBeGreaterThan(editorBefore.y + 100)
    const scrolls = await panel.evaluate((p) => p.scrollHeight > p.clientHeight)
    expect(scrolls).toBe(false)
    void article
  })

  test('J-07: wide tables do not let the article\'s focus border show through their cells', async ({ page, margin }) => {
    const wide = 'x'.repeat(300)
    margin.write('a.md', `# T\n\n| ${wide} | ${wide} |\n|---|---|\n| 1 | 2 |\n`)
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > h1').click()
    await page.keyboard.press('e')
    const table = page.locator('.table-block table')
    const bg = await table.evaluate((t) => getComputedStyle(t).backgroundColor)
    expect(bg).toBe('rgb(10, 11, 23)')
    // The table reaches over the text column's edge, where the article's border would be.
    const text = (await page.locator('.ProseMirror > h1').boundingBox())!
    const box = (await table.boundingBox())!
    expect(box.x).toBeLessThan(text.x)
  })
})
