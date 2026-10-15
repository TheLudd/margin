// Section 7 as seen from the browser: never stale (N), with the T-05
// writes, commits and branch switches.
import { expect, open, test } from './fixtures'

/** Counts the document reloads the page performs. */
async function countReloads(page: import('@playwright/test').Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { reloads: number }
    w.reloads = 0
    document.addEventListener('margin:reloaded', () => w.reloads++)
  })
  return () => page.evaluate(() => (window as unknown as { reloads: number }).reloads)
}

test.describe('never stale', () => {
  test('N-01, T-05: a change to the open file on disk, in place or via rename, reaches the browser and the document reloads in place', async ({ page, margin }) => {
    margin.write('a.md', '# One\n\n' + 'para\n\n'.repeat(80) + '## End\n')
    await open(page, margin, 'a.md')
    await page.locator('#main').evaluate((m) => m.scrollTo({ top: 600 }))
    margin.write('a.md', '# Two\n\n' + 'para\n\n'.repeat(80) + '## End\n')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Two')
    const scroll = await page.locator('#main').evaluate((m) => m.scrollTop)
    expect(scroll).toBeGreaterThan(500)
    margin.writeAtomic('a.md', '# Three\n\n' + 'para\n\n'.repeat(80) + '## End\n')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Three')
    await expect(page).toHaveURL(margin.url + '/code/a.md')
  })

  test('N-02: the echo of the browser\'s own save is ignored', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\ntext\n')
    await open(page, margin, 'a.md')
    const reloads = await countReloads(page)
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' more')
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    await page.waitForTimeout(700)
    expect(margin.read('a.md')).toBe('# A\n\ntext more\n')
    expect(await reloads()).toBe(0)
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true')
  })

  test('N-03: on focus and on visibility the open file is revalidated with its etag', async ({ page, margin }) => {
    margin.write('a.md', '# A\n')
    await open(page, margin, 'a.md')
    // Without the stream, only revalidation can notice the change.
    await page.route('**/api/events', (route) => route.abort())
    const conditional: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/file/') && r.method() === 'GET') conditional.push(r.headers()['if-none-match'] ?? '')
    })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => conditional.length).toBe(1)
    expect(conditional[0]).toMatch(/^"/)
    await expect(page.locator('.ProseMirror > h1')).toHaveText('A')
    margin.write('a.md', '# Changed while away\n')
    await page.waitForTimeout(400)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Changed while away')
    expect(conditional.length).toBeGreaterThanOrEqual(2)
  })

  test('N-04: after a service restart the stream is reopened and the open file and lists are refetched', async ({ page, margin }) => {
    margin.write('a.md', '# A\n')
    await open(page, margin, 'a.md')
    await margin.stop()
    margin.write('a.md', '# Changed while down\n')
    margin.write('b.md', '# B\n')
    await page.waitForTimeout(1500)
    await margin.restart()
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Changed while down', { timeout: 20_000 })
    await expect(page.locator('#sidebar a[href="/code/b.md"]')).toHaveCount(1, { timeout: 20_000 })
  })

  test('N-04: an error response on the stream is retried with backoff from 1s doubling to 10s', async ({ page, margin }) => {
    margin.write('a.md', '# A\n')
    await open(page, margin, 'a.md')
    const times: number[] = []
    let failing = true
    await page.route('**/api/events', (route) => {
      times.push(Date.now())
      if (failing) return route.fulfill({ status: 502, body: 'bad gateway' })
      return route.continue()
    })
    // Break the live stream: a 502 from a proxy during a restart.
    await margin.restart()
    await expect.poll(() => times.length, { timeout: 25_000 }).toBeGreaterThanOrEqual(4)
    const gaps = times.slice(1).map((t, i) => t - times[i])
    expect(gaps[1]).toBeGreaterThan(gaps[0] * 1.5)
    expect(gaps[2]).toBeGreaterThan(gaps[1] * 1.5)
    failing = false
    margin.write('a.md', '# Back\n')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Back', { timeout: 20_000 })
  })

  test('N-05, T-05: a commit and a branch switch are pushed; the open file refetches its state', async ({ page, margin }) => {
    margin.repo('repo', { 'a.md': '# Committed\n' })
    margin.write('repo/a.md', '# Edited on disk\n')
    await open(page, margin, 'repo/a.md')
    await expect(page.locator('.doc-header .commit')).toHaveText('uncommitted')
    margin.git('repo', 'commit', '-q', '-am', 'edit')
    await expect(page.locator('.doc-header .commit')).toHaveText('committed')
    margin.git('repo', 'checkout', '-q', '-b', 'other')
    margin.write('repo/a.md', '# On other\n')
    margin.git('repo', 'commit', '-q', '-am', 'other')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('On other')
    margin.git('repo', 'checkout', '-q', 'main')
    await expect(page.locator('.ProseMirror > h1')).toHaveText('Edited on disk')
    await expect(page.locator('.doc-header .commit')).toHaveText('committed')
  })

  test('N-06: an outside change while editing shows a banner; keep mine writes my version', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\ntext\n')
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' mine')
    margin.write('a.md', '# A\n\ntheirs\n')
    const banner = page.locator('.banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('changed on disk')
    await expect(page.locator('.doc-header .status')).toHaveText('conflict')
    await expect(page.locator('.ProseMirror > p')).toHaveText('text mine')
    expect(margin.read('a.md')).toBe('# A\n\ntheirs\n')
    await banner.getByRole('button', { name: 'keep mine' }).click()
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 5000 })
    await expect(banner).toBeHidden()
    expect(margin.read('a.md')).toBe('# A\n\ntext mine\n')
  })

  test('N-06: take theirs shows their version and drops my edits', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\ntext\n')
    await open(page, margin, 'a.md')
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' mine')
    margin.writeAtomic('a.md', '# A\n\ntheirs\n')
    const banner = page.locator('.banner')
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'take theirs' }).click()
    await expect(banner).toBeHidden()
    await expect(page.locator('.ProseMirror > p')).toHaveText('theirs')
    await expect(page.locator('.doc-header .status')).toHaveText('saved')
    await page.waitForTimeout(1500)
    expect(margin.read('a.md')).toBe('# A\n\ntheirs\n')
  })

  test('N-07: a failed save retries after 5s and the status says so', async ({ page, margin }) => {
    margin.write('a.md', '# A\n\ntext\n')
    await open(page, margin, 'a.md')
    let failing = true
    const attempts: number[] = []
    await page.route('**/api/file/**', (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      attempts.push(Date.now())
      if (failing) return route.abort()
      return route.continue()
    })
    await page.locator('.ProseMirror > p').click()
    await page.keyboard.press('e')
    await page.keyboard.press('End')
    await page.keyboard.type(' more')
    await expect(page.locator('.doc-header .status')).toHaveText('retrying', { timeout: 5000 })
    failing = false
    await expect(page.locator('.doc-header .status')).toHaveText('saved', { timeout: 8000 })
    expect(attempts.length).toBe(2)
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(4900)
    expect(margin.read('a.md')).toBe('# A\n\ntext more\n')
  })
})
