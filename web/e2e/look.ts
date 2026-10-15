// Helpers for reading the look (L): computed styles, colours as numbers.
import { expect, type Locator, type Page } from '@playwright/test'

export const tokens = {
  bg: '#0a0b17',
  panel: '#10122a',
  raised: '#171a3a',
  line: '#2a2f63',
  text: '#d6dbff',
  muted: '#7f86c2',
  cyan: '#00e5ff',
  magenta: '#ff2bd6',
  h3: '#8fa8ff',
  code: '#5cffa8',
  warn: '#ffb347',
  removed: '#ff5c7a',
}

export const mono = '"Source Code Pro", "DejaVuSansM Nerd Font", monospace'
export const sans = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export type RGBA = [number, number, number, number]

/** Parses rgb(), rgba(), color(srgb …) and #hex into 0–255 channels and alpha. */
export function parseColor(s: string): RGBA {
  s = s.trim()
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1]
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number)
    return [parts[0], parts[1], parts[2], parts[3] ?? 1]
  }
  m = /^color\(srgb ([^)]+)\)$/.exec(s)
  if (m) {
    const parts = m[1].split(/[\s\/]+/).filter(Boolean).map(Number)
    return [Math.round(parts[0] * 255), Math.round(parts[1] * 255), Math.round(parts[2] * 255), parts[3] ?? 1]
  }
  throw new Error('unreadable colour: ' + s)
}

/** The first colour found in a longer value, such as a shadow or gradient. */
export function firstColor(s: string): RGBA {
  const m = /(color\(srgb [^)]+\)|rgba?\([^)]+\)|#[0-9a-f]{6,8})/i.exec(s)
  if (!m) throw new Error('no colour in: ' + s)
  return parseColor(m[1])
}

export function sameColor(got: string, want: string, alpha = 1, tolerance = 2): void {
  const g = parseColor(got)
  const w = parseColor(want)
  for (let i = 0; i < 3; i++) expect(Math.abs(g[i] - w[i]), `${got} vs ${want}`).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(g[3] - alpha), `${got} alpha vs ${alpha}`).toBeLessThan(0.02)
}

export async function css(locator: Locator, prop: string, pseudo?: string): Promise<string> {
  return locator.evaluate((el, [p, ps]) => getComputedStyle(el, ps || undefined).getPropertyValue(p), [prop, pseudo ?? ''])
}

export async function expectCss(locator: Locator, props: Record<string, string>, pseudo?: string): Promise<void> {
  for (const [prop, want] of Object.entries(props)) {
    const got = await css(locator, prop, pseudo)
    expect(got, `${prop}`).toBe(want)
  }
}

export async function expectColor(locator: Locator, prop: string, want: string, alpha = 1, pseudo?: string): Promise<void> {
  sameColor(await css(locator, prop, pseudo), want, alpha)
}

/** The built stylesheets' text. */
export async function stylesheetText(page: Page): Promise<string> {
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => (l as HTMLLinkElement).href))
  let text = ''
  for (const href of hrefs) text += (await page.request.get(href).then((r) => r.text())) + '\n'
  return text
}

/** Resolves any CSS colour value, color-mix included, through the page. */
export async function resolveColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement('span')
    el.style.color = v
    document.body.append(el)
    const out = getComputedStyle(el).color
    el.remove()
    return out
  }, value)
}

/** Resolves a shadow value's colour through the page. */
export async function resolveShadowColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement('span')
    el.style.boxShadow = v
    document.body.append(el)
    const out = getComputedStyle(el).boxShadow
    el.remove()
    return out
  }, value)
}
