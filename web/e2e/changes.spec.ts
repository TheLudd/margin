// Section 8 as seen from the browser: changes (CH).
import fs from 'node:fs'
import path from 'node:path'
import { expect, open, recent, test, type Margin } from './fixtures'
import type { Page } from '@playwright/test'

const paras = (n: number, over: Record<number, string> = {}) =>
  '# Doc\n\n' +
  Array.from({ length: n }, (_, i) => over[i + 1] ?? `Paragraph ${i + 1} with some words in it.`)
    .filter((p) => p !== '')
    .join('\n\n') +
  '\n'

/** Opens a file (creating its copy), then writes a changed version outside. */
async function openThenChange(page: Page, margin: Margin, rel: string, before: string, after: string): Promise<void> {
  margin.write(rel, before)
  await open(page, margin, rel)
  await expect(page.locator('.doc-header .changes')).toBeHidden()
  margin.write(rel, after)
  await expect(page.locator('.doc-header .changes')).toBeVisible()
}

test.describe('changes', () => {
  test('CH-01, CH-02, CH-05, CH-06: outside changes since the copy show as bars: green for new, amber for changed, a red notch where removed; nearby changes are one change', async ({ page, margin }) => {
    const before = paras(8)
    const after = paras(8, { 2: 'Paragraph 2 with some different words in it.', 4: 'Paragraph 4 with some words in it.\n\nA brand new paragraph.', 7: '' })
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveText('Paragraph 2 with some different words in it.')
    await expect(page.locator('.ProseMirror .change-block.change-added')).toHaveText('A brand new paragraph.')
    await expect(page.locator('.ProseMirror .change-removed')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-removed')).toHaveClass(/change-collapsed/)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await expect(page.locator('.doc-header .changes .mark-read')).toBeVisible()
  })

  test('CH-06: changed or removed blocks separated by at most one unchanged block are one change', async ({ page, margin }) => {
    const before = paras(6)
    const after = paras(6, { 2: 'Paragraph 2 changed a lot of its words.', 4: 'Paragraph 4 changed a lot of its words.' })
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(2)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 unread change')
  })

  test('CH-02: a never-opened file has no unread changes; changes made while the browser is closed show on the next open', async ({ page, margin }) => {
    margin.write('fresh.md', paras(3))
    margin.write('fresh.md', paras(3, { 2: 'Changed before anyone read it.' }))
    await open(page, margin, 'fresh.md')
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(0)
    await page.goto(margin.url + '/')
    margin.write('fresh.md', paras(3, { 2: 'Changed before anyone read it.', 3: 'Paragraph 3 with some words changed while the browser was away.' }))
    await open(page, margin, 'fresh.md')
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveText('Paragraph 3 with some words changed while the browser was away.')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 unread change')
  })

  test('CH-03, S-01: several outside writes add up into one diff until marked read; mark read clears it and turns the entry into a view', async ({ page, margin }) => {
    await openThenChange(page, margin, 'a.md', paras(5), paras(5, { 1: 'Paragraph 1 with some words changed first.' }))
    margin.write('a.md', paras(5, { 1: 'Paragraph 1 with some words changed first.', 4: 'Paragraph 4 with some words changed second.' }))
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveCount(2)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('2 unread changes')
    await expect(recent(page).locator('a[href="/code/a.md"]')).toHaveClass(/unread/)
    await page.locator('.doc-header .changes .mark-read').click()
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(0)
    await expect(recent(page).locator('a[href="/code/a.md"]')).not.toHaveClass(/unread/)
    await expect(recent(page).locator('a[href="/code/a.md"] time')).not.toHaveClass(/modified/)
    margin.write('a.md', paras(5, { 1: 'Paragraph 1 with some words changed first.', 4: 'Paragraph 4 with some words changed second.', 5: 'Paragraph 5 with some words changed third.' }))
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 unread change')
  })

  test('CH-04: copies older than unreadDays are swept at startup, so the file counts as never opened', async ({ page, margin }) => {
    margin.write('a.md', paras(3))
    await open(page, margin, 'a.md')
    await expect(recent(page).locator('a[href="/code/a.md"]')).toHaveCount(1)
    await margin.stop()
    margin.writeConfig({ roots: [{ name: 'code', path: '~/code' }], unreadDays: 1 })
    const copies = path.join(margin.stateDir, 'copies')
    const old = new Date(Date.now() - 3 * 86400 * 1000)
    for (const f of fs.readdirSync(copies)) fs.utimesSync(path.join(copies, f), old, old)
    await margin.restart()
    margin.write('a.md', paras(3, { 1: 'Changed after the sweep.' }))
    await page.goto(margin.url + '/')
    await expect(recent(page).locator('a[href="/code/a.md"]')).toHaveCount(1)
    await expect(recent(page).locator('a[href="/code/a.md"]')).not.toHaveClass(/unread/)
    await open(page, margin, 'a.md')
    await expect(page.locator('.doc-header .changes')).toBeHidden()
  })

  test('CH-05, L-30: a code block or table counts as one block; changed table cells are tinted and new rows green', async ({ page, margin }) => {
    const before = '# T\n\n```js\nconst a = 1\nconst b = 2\n```\n\n| name | n |\n|---|---|\n| one | 1 |\n| two | 2 |\n'
    const after = '# T\n\n```js\nconst a = 1\nconst b = 3\n```\n\n| name | n |\n|---|---|\n| one | 1 |\n| two | 22 |\n| three | 3 |\n'
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.ProseMirror .code-block.change-block.change-modified')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .table-block.change-block.change-modified')).toHaveCount(1)
    await expect(page.locator('.ProseMirror td.change-cell:not(.change-cell-added)')).toHaveCount(1)
    await expect(page.locator('.ProseMirror td.change-cell:not(.change-cell-added)')).toHaveText('22')
    await expect(page.locator('.ProseMirror td.change-cell-added')).toHaveCount(2)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 unread change')
  })

  test('CH-05: bars stay in the gutter at any list depth', async ({ page, margin }) => {
    const before = '# L\n\n- one\n  - nested one\n  - nested two\n- two\n'
    const after = '# L\n\n- one\n  - nested one\n  - nested two changed\n- two\n'
    await openThenChange(page, margin, 'a.md', before, after)
    const block = page.locator('.ProseMirror .change-block')
    await expect(block).toHaveCount(1)
    const text = (await page.locator('.ProseMirror > h1').boundingBox())!
    const bar = await block.evaluate((el) => {
      const s = getComputedStyle(el, '::after')
      const r = el.getBoundingClientRect()
      return { left: r.left + parseFloat(s.left), width: parseFloat(s.width) }
    })
    expect(bar.left).toBeLessThan(text.x)
    expect(bar.width).toBe(3)
  })

  test('CH-06, CH-07, K: the count is a button to the first change; Alt ↑ ↓ and the arrows step through, centering and pulsing the target', async ({ page, margin }) => {
    const before = paras(40)
    const after = paras(40, { 5: 'Paragraph 5 changed with other words.', 20: 'Paragraph 20 changed with other words.', 35: 'Paragraph 35 changed with other words.' })
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await page.locator('.doc-header .changes .count').click()
    const current = page.locator('.ProseMirror .change-current')
    await expect(current).toHaveText('Paragraph 5 changed with other words.')
    await expect(page.locator('.ProseMirror .change-pulse')).toHaveCount(1)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 1 of 3')
    await page.keyboard.press('Alt+ArrowDown')
    await expect(current).toHaveText('Paragraph 20 changed with other words.')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 2 of 3')
    const box = (await current.boundingBox())!
    const main = (await page.locator('#main').boundingBox())!
    const centre = box.y + box.height / 2 - main.y
    expect(Math.abs(centre - main.height / 2)).toBeLessThan(60)
    await page.locator('.doc-header .changes .next').click()
    await expect(current).toHaveText('Paragraph 35 changed with other words.')
    await expect(page.locator('.doc-header .changes .next')).toBeDisabled()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(current).toHaveText('Paragraph 20 changed with other words.')
    await page.locator('.doc-header .changes .prev').click()
    await expect(current).toHaveText('Paragraph 5 changed with other words.')
    await expect(page.locator('.doc-header .changes .prev')).toBeDisabled()
  })

  test('CH-07: a change is current until it leaves the screen; from no current change stepping goes from the middle of the view', async ({ page, margin }) => {
    const before = paras(40)
    const after = paras(40, { 5: 'Paragraph 5 changed with other words.', 20: 'Paragraph 20 changed with other words.', 35: 'Paragraph 35 changed with other words.' })
    await openThenChange(page, margin, 'a.md', before, after)
    // From the top, paragraph 5 sits above the middle of the view: the next change from the middle is the second.
    await page.keyboard.press('Alt+ArrowDown')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 2 of 3')
    await page.locator('#main').evaluate((m) => m.scrollTo({ top: m.scrollHeight }))
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await expect(page.locator('.ProseMirror .change-current')).toHaveCount(0)
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.locator('.ProseMirror .change-current')).toHaveText('Paragraph 35 changed with other words.')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 3 of 3')
  })

  test('CH-08, CH-09: three buttons beside a change show it as now, as a diff or as it was; a pick stays while the file is open', async ({ page, margin }) => {
    const before = '# D\n\nThe quick brown fox jumps over the lazy dog.\n\nSecond paragraph stays.\n\nThird paragraph stays too.\n\n```\nold code\n```\n'
    const after = '# D\n\nThe quick red fox jumps over the lazy dog today.\n\nSecond paragraph stays.\n\nThird paragraph stays too.\n\n```\nnew code\n```\n'
    await openThenChange(page, margin, 'a.md', before, after)
    const first = page.locator('.ProseMirror .change-block').first()
    await first.hover()
    const controls = page.locator('.ProseMirror .change-controls').first()
    await expect(controls.locator('button')).toHaveCount(3)
    await expect(controls.locator('button[data-view=now]')).toHaveClass(/active/)
    await controls.locator('button[data-view=diff]').click()
    await expect(page.locator('.ProseMirror .change-inserted')).toHaveCount(2)
    await expect(page.locator('.ProseMirror .change-deleted')).toHaveText('brown')
    await expect(page.locator('.ProseMirror .change-inserted').first()).toHaveText('red')
    await first.hover()
    await controls.locator('button[data-view=was]').click()
    await expect(page.locator('.ProseMirror .change-hidden')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-old')).toContainText('The quick brown fox jumps over the lazy dog.')
    await expect(page.locator('.ProseMirror .change-old .change-note')).toHaveText('as it was')
    // The code block, a separate change, still shows as it is now; as a diff the old version sits above.
    await expect(page.locator('.ProseMirror .code-block.change-block')).toHaveCount(1)
    await page.locator('.ProseMirror .code-block.change-block').hover()
    await page.locator('.ProseMirror .change-controls').last().locator('button[data-view=diff]').click()
    await expect(page.locator('.ProseMirror .change-old pre')).toContainText('old code')
    // Picks stay through an edit elsewhere (the marks follow edits, CH-10).
    await page.locator('.ProseMirror > p', { hasText: 'Second paragraph' }).click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' edited')
    await page.waitForTimeout(400)
    await expect(page.locator('.ProseMirror .change-hidden')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-old pre')).toContainText('old code')
    // And reset when the file is opened again (CH-09).
    await page.goto(margin.url + '/')
    await open(page, margin, 'a.md')
    await expect(page.locator('.ProseMirror .change-hidden')).toHaveCount(0)
    await expect(page.locator('.ProseMirror .change-block').first()).toHaveText('The quick red fox jumps over the lazy dog today.')
  })

  test('CH-08, J-04: the buttons sit left of the bar and hide only after a delay', async ({ page, margin }) => {
    await openThenChange(page, margin, 'a.md', paras(3), paras(3, { 2: 'Paragraph 2 changed with other words.' }))
    const block = page.locator('.ProseMirror .change-block')
    const controls = page.locator('.ProseMirror .change-controls > span')
    await block.hover()
    await expect(controls).toBeVisible()
    const c = (await controls.boundingBox())!
    const b = (await block.boundingBox())!
    expect(c.x + c.width).toBeLessThanOrEqual(b.x)
    await page.mouse.move(c.x + c.width - 8, c.y + 8)
    await expect(controls).toBeVisible()
    await page.mouse.move(5, 5)
    await page.waitForTimeout(150)
    await expect(controls).toBeVisible()
    await expect(controls).toBeHidden({ timeout: 2000 })
  })

  test('CH-10, CH-14: the document stays editable with changes shown; the reader\'s own edits never show as unread, also after a reload', async ({ page, margin }) => {
    await openThenChange(page, margin, 'a.md', paras(4), paras(4, { 2: 'Paragraph 2 changed outside with other words.' }))
    await page.locator('.ProseMirror > p', { hasText: 'Paragraph 4' }).click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited by me.')
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-block')).toHaveText('Paragraph 2 changed outside with other words.')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    await page.waitForTimeout(500)
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'document')
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-block')).toHaveText('Paragraph 2 changed outside with other words.')
    await expect(page.locator('.ProseMirror > p', { hasText: 'Edited by me' })).not.toHaveClass(/change-block/)
  })

  test('CH-14: without unread changes an edit in margin shows no change at all', async ({ page, margin }) => {
    margin.write('a.md', paras(3))
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > p', { hasText: 'Paragraph 1' }).click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited.')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    await page.waitForTimeout(500)
    await expect(page.locator('.ProseMirror .change-block')).toHaveCount(0)
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    await page.reload()
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'document')
    await expect(page.locator('.doc-header .changes')).toBeHidden()
  })

  test('CH-11, CH-12, CH-01: uncommitted is clickable and switches the baseline to the last commit and back; mark read shows only for the unread baseline', async ({ page, margin }) => {
    margin.repo('repo', { 'a.md': paras(3) })
    margin.write('repo/a.md', paras(3, { 2: 'Paragraph 2 with some words changed since the commit.' }))
    await open(page, margin, 'repo/a.md')
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    const badge = page.locator('.doc-header .commit')
    await expect(badge).toHaveText('uncommitted')
    await badge.click()
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 uncommitted change')
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveText('Paragraph 2 with some words changed since the commit.')
    await expect(page.locator('.doc-header .changes .mark-read')).toBeHidden()
    await expect(badge).toHaveClass(/active/)
    await badge.click()
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    await expect(badge).not.toHaveClass(/active/)
    // A new unread change switches to it (CH-01).
    await badge.click()
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 uncommitted change')
    margin.write('repo/a.md', paras(3, { 2: 'Paragraph 2 with some words changed since the commit.', 3: 'Paragraph 3 with some words changed just now.' }))
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 unread change')
    await expect(page.locator('.doc-header .changes .mark-read')).toBeVisible()
  })

  test('CH-13: a manual file counts its changes as read; toggling either way records the current version as read', async ({ page, margin }) => {
    margin.write('a.md', paras(3))
    await open(page, margin, 'a.md')
    await page.locator('.doc-header .manual').click()
    await expect(page.locator('.doc-header .manual')).toHaveClass(/active/)
    margin.write('a.md', paras(3, { 1: 'Paragraph 1 edited by hand.' }))
    await expect(page.locator('.ProseMirror > p').first()).toHaveText('Paragraph 1 edited by hand.')
    await page.waitForTimeout(500)
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    await expect(recent(page).locator('a[href="/code/a.md"]')).not.toHaveClass(/unread/)
    await page.locator('.doc-header .manual').click()
    await expect(page.locator('.doc-header .manual')).not.toHaveClass(/active/)
    await expect(page.locator('.doc-header .changes')).toBeHidden()
    margin.write('a.md', paras(3, { 1: 'Paragraph 1 edited by hand.', 2: 'Paragraph 2 changed after manual was off.' }))
    await expect(page.locator('.doc-header .changes .count')).toHaveText('1 unread change')
    await expect(page.locator('.ProseMirror .change-block')).toHaveText('Paragraph 2 changed after manual was off.')
  })
})
