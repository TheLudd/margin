// Sections 2 and 3 as seen from the browser: operation (P) and config (C).
import fs from 'node:fs'
import path from 'node:path'
import { expect, here, Margin, older, test } from './fixtures'

test.describe('operation', () => {
  test('P-04, P-05: margin binds to loopback on the port given, and -port 0 picks a free one', async ({ margin }) => {
    expect(margin.stderr).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+/)
    expect(margin.port).toBeGreaterThan(0)
  })

  test('P-01: the page and its script come from the single binary', async ({ page, margin }) => {
    await page.goto(margin.url + '/')
    await expect(page.locator('#sidebar .brand')).toHaveText('margin')
    const scripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src))
    expect(scripts.some((s) => s.includes('/assets/'))).toBe(true)
  })

  test('P-06: a request with a foreign Host is refused, one naming margin is served', async ({ margin, request }) => {
    const bad = await request.get(margin.url + '/api/lists', { headers: { Host: 'evil.example' } })
    expect(bad.status()).toBe(403)
    const good = await request.get(margin.url + '/api/lists')
    expect(good.status()).toBe(200)
    const origin = await request.get(margin.url + '/api/lists', { headers: { Origin: 'http://evil.example' } })
    expect(origin.status()).toBe(403)
  })

  test('P-04, P-06: a -host name is accepted', async ({ request }) => {
    const m = await Margin.start({ flags: ['-host', 'margin.local'] })
    try {
      const res = await request.get(m.url + '/api/lists', { headers: { Host: 'margin.local' } })
      expect(res.status()).toBe(200)
    } finally {
      await m.cleanup()
    }
  })

  test('P-02, P-03: config and state live where the flags say', async ({ margin, page }) => {
    await page.goto(margin.url + '/settings')
    await expect(page.locator('.settings .file')).toContainText(margin.configFile)
    expect(fs.existsSync(path.join(margin.stateDir, 'copies'))).toBe(true)
  })

  test('P-09: a tab connected to an older build reloads', async ({ page, margin }) => {
    margin.write('a.md', '# A\n')
    await page.goto(margin.url + '/')
    await expect(page.locator('#sidebar .brand')).toHaveText('margin')
    await page.evaluate(() => {
      ;(window as unknown as { marker: string }).marker = 'before'
    })
    // A new build: the same binary with a byte appended has a new build id.
    const other = path.join(margin.home, 'margin-next')
    fs.copyFileSync(path.resolve(here, '..', '..', 'margin'), other)
    fs.appendFileSync(other, '\n')
    fs.chmodSync(other, 0o755)
    await margin.restart([], other)
    await expect.poll(() => page.evaluate(() => (window as unknown as { marker?: string }).marker ?? 'reloaded'), { timeout: 15_000 }).toBe('reloaded')
    await expect(page.locator('#sidebar .brand')).toHaveText('margin')
  })

  test('P-11: no login is asked for', async ({ page, margin }) => {
    await page.goto(margin.url + '/')
    await expect(page.locator('#sidebar .brand')).toHaveText('margin')
    await expect(page.locator('input[type=password]')).toHaveCount(0)
  })
})

test.describe('config', () => {
  test('C-04: without a usable root the browser shows a setup screen asking for folders', async ({ page }) => {
    const m = await Margin.start({ config: false })
    try {
      await page.goto(m.url + '/')
      await expect(page.locator('#main')).toHaveAttribute('data-view', 'settings')
      await expect(page.locator('.settings h1')).toHaveText('Welcome to margin')
      await expect(page.locator('#sidebar details[data-section=recent]')).toBeHidden()
      await expect(page.locator('#sidebar .find')).toBeHidden()
      await expect(page.locator('#sidebar .brand')).toBeVisible()
    } finally {
      await m.cleanup()
    }
  })

  test('C-05: the setup screen suggests the visible folders in home that hold markdown, with counts, served ones left out', async ({ page }) => {
    const m = await Margin.start({ config: false })
    try {
      fs.mkdirSync(path.join(m.home, 'notes'), { recursive: true })
      fs.writeFileSync(path.join(m.home, 'notes', 'a.md'), 'a')
      fs.writeFileSync(path.join(m.home, 'notes', 'b.md'), 'b')
      fs.mkdirSync(path.join(m.home, '.hidden'), { recursive: true })
      fs.writeFileSync(path.join(m.home, '.hidden', 'c.md'), 'c')
      fs.mkdirSync(path.join(m.home, 'empty'), { recursive: true })
      m.write('one.md', '1')
      await page.goto(m.url + '/')
      const rows = page.locator('.settings .suggestion')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0).locator('.path')).toHaveText('~/code')
      await expect(rows.nth(0).locator('.files')).toHaveText('1')
      await expect(rows.nth(1).locator('.path')).toHaveText('~/notes')
      await expect(rows.nth(1).locator('.files')).toHaveText('2')
      await rows.nth(1).locator('button.add').click()
      await expect(page.locator('.settings .root input[name=folder]')).toHaveValue('~/notes')
      await expect(page.locator('.settings .root input[name=name]')).toHaveValue('notes')
      await expect(rows).toHaveCount(1)
    } finally {
      await m.cleanup()
    }
  })

  test('C-05: on the settings screen folders already served are not suggested', async ({ page, margin }) => {
    margin.write('one.md', '1')
    fs.mkdirSync(path.join(margin.home, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(margin.home, 'notes', 'a.md'), 'a')
    await page.goto(margin.url + '/settings')
    const rows = page.locator('.settings .suggestion')
    await expect(rows).toHaveCount(1)
    await expect(rows.first().locator('.path')).toHaveText('~/notes')
  })

  test('C-06: the folder field completes paths as typed, hidden ones once a dot is typed, and the name follows the base name until edited', async ({ page, margin }) => {
    fs.mkdirSync(path.join(margin.home, 'notes'), { recursive: true })
    fs.mkdirSync(path.join(margin.home, '.config'), { recursive: true })
    await page.goto(margin.url + '/settings')
    await page.locator('.settings button.add', { hasText: 'add a folder' }).click()
    const row = page.locator('.settings .root').last()
    const folder = row.locator('input[name=folder]')
    const name = row.locator('input[name=name]')
    await folder.pressSequentially('~/no')
    const options = () => row.locator('datalist option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    await expect.poll(options).toEqual(['~/notes'])
    await expect(name).toHaveValue('no')
    await folder.fill('~/notes')
    await expect(name).toHaveValue('notes')
    await folder.fill('~/')
    await expect.poll(options).toEqual(['~/code', '~/notes'])
    await folder.fill('~/.c')
    await expect.poll(options).toEqual(['~/.config'])
    await name.fill('mine')
    await folder.fill('~/notes')
    await expect(name).toHaveValue('mine')
  })

  test('F-08: the settings suggest a type for a recurring file name; adding it fills a row and saving applies it', async ({ page, margin }) => {
    for (const p of ['a/CLAUDE.md', 'b/CLAUDE.md', 'c/CLAUDE.md']) margin.write(p, '# Rules\n')
    await page.goto(margin.url + '/')
    await expect(page.locator('#sidebar details[data-section=older] details.project')).toHaveCount(3)
    await page.goto(margin.url + '/settings')
    const suggestion = page.locator('.settings .type-suggestion')
    await expect(suggestion).toHaveCount(1)
    await expect(suggestion.locator('.pattern')).toHaveText('CLAUDE.md')
    await expect(suggestion.locator('.files')).toHaveText('3')
    await suggestion.locator('button.add').click()
    await expect(page.locator('.settings .type-suggestion')).toHaveCount(0)
    const row = page.locator('.settings .type').last()
    await expect(row.locator('input[name=typeName]')).toHaveValue('claude')
    await expect(row.locator('input[name=typeMatch]')).toHaveValue('CLAUDE.md')
    await page.locator('.settings button.primary').click()
    await expect(page.locator('.settings .type-suggestions .none')).toBeVisible()
    await expect(page.locator('#sidebar a[href="/code/a/CLAUDE.md"] .file-label .mark')).toHaveText('claude')
  })

  test('C-07, C-01: saving writes the file, re-indexes without a restart behind a busy overlay, and the new root shows in the sidebar', async ({ page, margin }) => {
    fs.mkdirSync(path.join(margin.home, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(margin.home, 'notes', 'todo.md'), '# Todo\n')
    await page.goto(margin.url + '/settings')
    await page.locator('.settings button.add', { hasText: 'add a folder' }).click()
    const row = page.locator('.settings .root').last()
    await row.locator('input[name=folder]').fill('~/notes')
    await page.locator('.settings textarea[name=exclude]').fill('CHANGELOG.md')
    await page.locator('.settings input[name=activeDays]').fill('7')
    await page.locator('.settings input[name=unreadDays]').fill('60')
    await page.locator('.settings button.add', { hasText: 'add a type' }).click()
    const type = page.locator('.settings .type').last()
    await type.locator('input[name=typeName]').fill('claude')
    await type.locator('input[name=typeMatch]').fill('CLAUDE.md')
    // Hold the save so the overlay can be seen.
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      await new Promise((r) => setTimeout(r, 700))
      await route.continue()
    })
    await page.locator('.settings button.primary').click()
    await expect(page.locator('dialog.busy')).toBeVisible()
    await expect(page.locator('dialog.busy')).toBeHidden({ timeout: 10_000 })
    await page.unroute('**/api/settings')
    const saved = JSON.parse(fs.readFileSync(margin.configFile, 'utf8'))
    expect(saved).toEqual({
      roots: [
        { name: 'code', path: '~/code' },
        { name: 'notes', path: '~/notes' },
      ],
      exclude: ['CHANGELOG.md'],
      types: [{ name: 'claude', match: 'CLAUDE.md' }],
      activeDays: 7,
      unreadDays: 60,
    })
    await expect(page.locator('#sidebar a[href="/notes/todo.md"]')).toHaveCount(1)
    await expect(page.locator('.settings input[name=activeDays]')).toHaveValue('7')
  })

  test('C-07: changing only the day counts applies without the busy overlay', async ({ page, margin }) => {
    await page.goto(margin.url + '/settings')
    let shown = false
    await page.exposeFunction('busyWatch', (v: boolean) => {
      shown = shown || v
    })
    await page.evaluate(() => {
      new MutationObserver(() => {
        const d = document.querySelector('dialog.busy')
        if (d?.hasAttribute('open')) (window as unknown as { busyWatch: (v: boolean) => void }).busyWatch(true)
      }).observe(document.body, { childList: true, subtree: true, attributes: true })
    })
    await page.locator('.settings input[name=activeDays]').fill('3')
    await page.locator('.settings button.primary').click()
    await expect(page.locator('#sidebar .empty').first()).toHaveText('Nothing in the last 3 days')
    expect(shown).toBe(false)
  })

  test('C-02: an invalid save is refused with a message and nothing changes', async ({ page, margin }) => {
    await page.goto(margin.url + '/settings')
    await page.locator('.settings button.add', { hasText: 'add a folder' }).click()
    const row = page.locator('.settings .root').last()
    await row.locator('input[name=folder]').fill('~/nowhere')
    await row.locator('input[name=name]').fill('code')
    await page.locator('.settings button.primary').click()
    const error = page.locator('.settings .error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('does not exist')
    await expect(error).toContainText('used twice')
    const saved = JSON.parse(fs.readFileSync(margin.configFile, 'utf8'))
    expect(saved.roots).toEqual([{ name: 'code', path: '~/code' }])
  })

  test('C-03: hand edits to the config are picked up live; a broken file keeps the roots and shows its error', async ({ page, margin }) => {
    margin.write('a.md', '# A\n')
    fs.mkdirSync(path.join(margin.home, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(margin.home, 'notes', 'todo.md'), '# Todo\n')
    await page.goto(margin.url + '/')
    await expect(page.locator('#sidebar a[href="/code/a.md"]')).toHaveCount(1)
    margin.writeConfig({ roots: [{ name: 'notes', path: '~/notes' }] })
    await expect(page.locator('#sidebar a[href="/notes/todo.md"]')).toHaveCount(1)
    await expect(page.locator('#sidebar a[href="/code/a.md"]')).toHaveCount(0)
    fs.writeFileSync(margin.configFile, '{"roots": [')
    await page.goto(margin.url + '/settings')
    await expect(page.locator('.settings .error')).toContainText('JSON')
    await expect(page.locator('#sidebar a[href="/notes/todo.md"]')).toHaveCount(1)
  })

  test('C-08: settings are reached by the gear at the foot of the sidebar and at /settings', async ({ page, margin }) => {
    for (let i = 0; i < 80; i++) margin.write(`many/file-${String(i).padStart(2, '0')}.md`, `# ${i}\n`)
    await page.goto(margin.url + '/')
    await older(page).locator('details.project summary').click()
    const gear = page.locator('#sidebar .settings-row')
    await expect(gear).toBeInViewport()
    await gear.click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.locator('#main')).toHaveAttribute('data-view', 'settings')
    await page.goto(margin.url + '/settings')
    await expect(page.locator('.settings h1')).toHaveText('Settings')
  })

  test('C-09: the settings screen shows where the config is stored', async ({ page, margin }) => {
    await page.goto(margin.url + '/settings')
    await expect(page.locator('.settings .file')).toContainText(margin.configFile)
  })
})
