// Section 8 as seen from the browser: changes (CH).
import fs from 'node:fs'
import path from 'node:path'
import { expect, here, open, recent, test, type Margin } from './fixtures'
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
  test('CH-01, CH-02, CH-05, CH-06, CH-08: outside changes since the copy show as bars: green for new, amber for changed, a red notch where removed; new words lit, a new paragraph lit whole', async ({ page, margin }) => {
    const before = paras(8)
    const after = paras(8, { 2: 'Paragraph 2 with some different words in it.', 4: 'Paragraph 4 with some words in it.\n\nA brand new paragraph.', 7: '' })
    await openThenChange(page, margin, 'a.md', before, after)
    const modified = page.locator('.ProseMirror .change-block.change-modified')
    await expect(modified).toHaveCount(1)
    await expect(modified).toHaveText('Paragraph 2 with some different words in it.')
    await expect(modified.locator('.change-inserted')).toHaveText('different')
    await expect(page.locator('.ProseMirror .change-gone')).toHaveCount(0)
    const added = page.locator('.ProseMirror .change-block.change-added')
    await expect(added).toHaveText('A brand new paragraph.')
    await expect(added.locator('.change-inserted')).toHaveText('A brand new paragraph.')
    await expect(page.locator('.ProseMirror .change-removed')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-removed')).toHaveClass(/change-collapsed/)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await expect(page.locator('.doc-header .changes .mark-read')).toBeVisible()
  })

  test('CH-06: every changed paragraph is a change of its own, whatever lies between; a paragraph rewritten in place is one change', async ({ page, margin }) => {
    const before = paras(6)
    const after = paras(6, { 2: 'Paragraph 2 changed a lot of its words.', 3: 'Something else entirely stands here now.', 4: 'Paragraph 4 changed a lot of its words.' })
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveCount(3)
    await expect(page.locator('.ProseMirror .change-removed')).toHaveCount(0)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
  })

  test('CH-05, CH-06, CH-08: each bullet is a unit: changed ones barred with their words lit, a removed one a notch between the items, a new one lit whole; bars stay in the gutter at any depth', async ({ page, margin }) => {
    const before = '# L\n\n- one apple\n- two pears\n  - nested one\n  - nested two\n- three plums\n- four figs\n'
    const after = '# L\n\n- one apple\n- two ripe pears\n  - nested one\n  - nested two changed\n- four figs\n- five dates\n'
    await openThenChange(page, margin, 'a.md', before, after)
    const blocks = page.locator('.ProseMirror li p.change-block')
    await expect(blocks).toHaveCount(3)
    await expect(blocks.nth(0)).toHaveText('two ripe pears')
    await expect(blocks.nth(0).locator('.change-inserted')).toHaveText('ripe')
    await expect(blocks.nth(1)).toHaveText('nested two changed')
    await expect(blocks.nth(2)).toHaveText('five dates')
    await expect(blocks.nth(2)).toHaveClass(/change-added/)
    await expect(blocks.nth(2).locator('.change-inserted')).toHaveText('five dates')
    const removed = page.locator('.ProseMirror li.change-removed')
    await expect(removed).toHaveCount(1)
    await expect(removed).toHaveClass(/change-collapsed/)
    await expect(page.locator('.ProseMirror ul.change-block')).toHaveCount(0)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('4 unread changes')
    const text = (await page.locator('.ProseMirror > h1').boundingBox())!
    for (const i of [0, 1, 2]) {
      const bar = await blocks.nth(i).evaluate((el) => {
        const s = getComputedStyle(el, '::after')
        const r = el.getBoundingClientRect()
        return { left: r.left + parseFloat(s.left), width: parseFloat(s.width) }
      })
      expect(Math.abs(bar.left - (text.x - 14))).toBeLessThan(1)
      expect(bar.width).toBe(3)
    }
    const notch = await removed.evaluate((el) => {
      const s = getComputedStyle(el, '::after')
      return el.getBoundingClientRect().left + parseFloat(s.left)
    })
    expect(Math.abs(notch - (text.x - 14))).toBeLessThan(1)
  })

  test('CH-05, CH-06: each hunk of a code block is a change: changed lines tinted amber, new ones green, a red notch where lines went', async ({ page, margin }) => {
    const before = '# T\n\n```js\na\nb\nc\nd\ne\n```\n\nBetween.\n\n```\none\ntwo\nthree\nfour\n```\n'
    const after = '# T\n\n```js\na\nB\nc\nd\ne\nf\n```\n\nBetween.\n\n```\none\nfour\n```\n'
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.ProseMirror .change-line.change-line-modified')).toHaveText('B')
    await expect(page.locator('.ProseMirror .change-line.change-line-added')).toHaveText('f')
    const gone = page.locator('.ProseMirror .change-gone-lines')
    await expect(gone).toHaveCount(1)
    await expect(gone).toHaveAttribute('title', 'removed:\ntwo\nthree')
    await expect(page.locator('.ProseMirror .code-block.change-holder')).toHaveCount(2)
    await expect(page.locator('.ProseMirror .code-block.change-block')).toHaveCount(0)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    // Stepping lands on lines inside the block.
    await page.locator('.doc-header .changes .count').click()
    await expect(page.locator('.ProseMirror .change-line.change-current')).toHaveText('B')
    await page.keyboard.press('n')
    await expect(page.locator('.ProseMirror .change-line.change-current')).toHaveText('f')
    await page.keyboard.press('n')
    await expect(page.locator('.ProseMirror .change-gone-lines.change-current')).toHaveCount(1)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 3 of 3')
  })

  test('CH-05, CH-06, L-30: each row of a table is a change: changed cells tinted, new rows green, a red line where a row went; the block has one pair of buttons', async ({ page, margin }) => {
    const before = '# T\n\n| name | n |\n|---|---|\n| one | 1 |\n| two | 2 |\n| three | 3 |\n'
    const after = '# T\n\n| name | n |\n|---|---|\n| two | 22 |\n| three | 3 |\n| four | 4 |\n'
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.ProseMirror .table-block.change-holder')).toHaveCount(1)
    await expect(page.locator('.ProseMirror td.change-cell:not(.change-cell-added)')).toHaveCount(1)
    await expect(page.locator('.ProseMirror td.change-cell:not(.change-cell-added)')).toHaveText('22')
    await expect(page.locator('.ProseMirror td.change-cell-added')).toHaveCount(2)
    await expect(page.locator('.ProseMirror tr.change-row')).toHaveCount(2)
    const gone = page.locator('.ProseMirror tr.change-row-gone')
    await expect(gone).toHaveCount(1)
    await expect(gone).toContainText('two')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await page.locator('.doc-header .changes .count').click()
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 1 of 3')
    await page.keyboard.press('n')
    await expect(page.locator('.ProseMirror tr.change-current')).toContainText('22')
    await page.locator('.ProseMirror .table-block').hover()
    const controls = page.locator('.ProseMirror .change-controls')
    await expect(controls).toHaveCount(1)
    await controls.locator('button[data-view=was]').click()
    await expect(page.locator('.ProseMirror .change-old table')).toContainText('one')
    await expect(page.locator('.ProseMirror .table-block.change-hidden')).toHaveCount(1)
  })

  test('CH-05, CH-06, CH-08: a real pair of versions of a skill file reads as its edits', async ({ page, margin }) => {
    const sample = path.join(here, '..', '..', 'samples', 'plan-skill')
    const before = fs.readFileSync(path.join(sample, 'before.md'), 'utf8')
    const after = fs.readFileSync(path.join(sample, 'after.md'), 'utf8')
    await openThenChange(page, margin, 'SKILL.md', before, after)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('9 unread changes')
    await expect(page.locator('.ProseMirror .change-block.change-modified')).toHaveCount(6)
    await expect(page.locator('.ProseMirror .change-block.change-added')).toHaveText(/^Rigor other than/)
    await expect(page.locator('.ProseMirror li.change-removed')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-gone-lines')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-inserted').first()).toHaveText('shape')
    await expect(page.locator('.ProseMirror .change-gone').first()).toHaveAttribute('title', 'removed: approach')
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

  test('CH-06, CH-07, K: the count is a button to the first change; N, P and the arrows step through, centering and pulsing the target', async ({ page, margin }) => {
    const before = paras(40)
    const after = paras(40, { 5: 'Paragraph 5 changed with other words.', 20: 'Paragraph 20 changed with other words.', 35: 'Paragraph 35 changed with other words.' })
    await openThenChange(page, margin, 'a.md', before, after)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await page.locator('.doc-header .changes .count').click()
    const current = page.locator('.ProseMirror .change-current')
    await expect(current).toHaveText('Paragraph 5 changed with other words.')
    await expect(page.locator('.ProseMirror .change-pulse')).toHaveCount(1)
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 1 of 3')
    await page.keyboard.press('n')
    await expect(current).toHaveText('Paragraph 20 changed with other words.')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 2 of 3')
    const box = (await current.boundingBox())!
    const main = (await page.locator('#main').boundingBox())!
    const centre = box.y + box.height / 2 - main.y
    expect(Math.abs(centre - main.height / 2)).toBeLessThan(60)
    await page.locator('.doc-header .changes .next').click()
    await expect(current).toHaveText('Paragraph 35 changed with other words.')
    await expect(page.locator('.doc-header .changes .next')).toBeDisabled()
    await page.keyboard.press('p')
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
    await page.keyboard.press('n')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 2 of 3')
    await page.locator('#main').evaluate((m) => m.scrollTo({ top: m.scrollHeight }))
    await expect(page.locator('.doc-header .changes .count')).toHaveText('3 unread changes')
    await expect(page.locator('.ProseMirror .change-current')).toHaveCount(0)
    await page.keyboard.press('p')
    await expect(page.locator('.ProseMirror .change-current')).toHaveText('Paragraph 35 changed with other words.')
    await expect(page.locator('.doc-header .changes .count')).toHaveText('Change 3 of 3')
  })

  test('CH-08, CH-09: new words are lit and removed ones marked; two buttons beside a change show it as now or as it was; a pick stays while the file is open', async ({ page, margin }) => {
    const before = '# D\n\nThe quick brown fox jumps over the lazy dog.\n\nSecond paragraph stays.\n\nThird paragraph stays too.\n\n```\nold code\n```\n'
    const after = '# D\n\nThe quick red fox jumps over the lazy dog today.\n\nSecond paragraph stays.\n\nThird paragraph stays too.\n\n```\nnew code\n```\n'
    await openThenChange(page, margin, 'a.md', before, after)
    const first = page.locator('.ProseMirror .change-block').first()
    await expect(page.locator('.ProseMirror .change-inserted')).toHaveCount(2)
    await expect(page.locator('.ProseMirror .change-inserted').first()).toHaveText('red')
    await expect(page.locator('.ProseMirror .change-inserted').last()).toHaveText(' today')
    await expect(page.locator('.ProseMirror .change-gone')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-gone')).toHaveAttribute('title', 'removed: brown')
    await first.hover()
    const controls = page.locator('.ProseMirror .change-controls').first()
    await expect(controls.locator('button')).toHaveCount(2)
    await expect(controls.locator('button[data-view=now]')).toHaveClass(/active/)
    await controls.locator('button[data-view=was]').click()
    await expect(page.locator('.ProseMirror .change-hidden')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-old')).toContainText('The quick brown fox jumps over the lazy dog.')
    await expect(page.locator('.ProseMirror .change-old .change-note')).toHaveText('as it was')
    await expect(page.locator('.ProseMirror .change-inserted')).toHaveCount(0)
    // The code block, a change of its own, still shows as it is now; as it was, the old block stands in its place.
    await expect(page.locator('.ProseMirror .code-block.change-holder')).toHaveCount(1)
    await expect(page.locator('.ProseMirror .change-line')).toHaveText('new code')
    await page.locator('.ProseMirror .code-block').hover()
    await page.locator('.ProseMirror .change-controls').last().locator('button[data-view=was]').click()
    await expect(page.locator('.ProseMirror .change-old pre')).toContainText('old code')
    // Picks stay through an edit elsewhere (the marks follow edits, CH-10).
    await page.locator('.ProseMirror > p', { hasText: 'Second paragraph' }).click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' edited')
    await page.waitForTimeout(400)
    await expect(page.locator('.ProseMirror .change-hidden')).toHaveCount(2)
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
