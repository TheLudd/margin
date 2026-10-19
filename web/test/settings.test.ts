import { describe, expect, it, vi } from 'vitest'
import { nameForFolder, renderSettings } from '../src/settings'
import type { SettingsView } from '../src/types'

function view(over: Partial<SettingsView> = {}): SettingsView {
  return {
    config: { roots: [{ name: 'code', path: '~/code' }], exclude: ['CHANGELOG.md'], types: [{ name: 'claude', match: 'CLAUDE.md', color: 'amber' }], activeDays: 14, unreadDays: 30 },
    file: '/home/u/.config/margin/config.json',
    state: '/home/u/.local/state/margin',
    error: '',
    ...over,
  }
}

function render(
  v: SettingsView,
  counts: Record<string, number> = {},
  suggestions = [{ path: '~/notes', count: 3, partial: false }],
  typeSuggestions = [
    { name: 'claude', match: 'CLAUDE.md', count: 3 },
    { name: 'skill', match: '.claude/skills/*/SKILL.md', count: 12 },
  ],
) {
  const container = document.createElement('section')
  const save = vi.fn(async () => {})
  const complete = vi.fn(async (q: string) => (q.startsWith('~/n') ? ['~/notes'] : []))
  const refs = renderSettings(container, {
    view: v,
    counts,
    actions: { save, complete, loadSuggestions: async () => suggestions, loadTypeSuggestions: async () => typeSuggestions },
  })
  return { container, refs, save, complete }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('settings', () => {
  it('C-06: the name follows the folder base name', () => {
    expect(nameForFolder('~/code')).toBe('code')
    expect(nameForFolder('/home/u/notes/')).toBe('notes')
    expect(nameForFolder('~')).toBe('home')
    expect(nameForFolder('')).toBe('')
  })

  it('C-01, C-09, C-02: the screen shows the roots grid, exclude, the day counts, the file location and any error', () => {
    const { container } = render(view({ error: 'folder ~/x does not exist' }))
    expect(container.querySelector('h1')?.textContent).toBe('Settings')
    expect(container.querySelectorAll('.root')).toHaveLength(1)
    expect((container.querySelector('.root input[name=name]') as HTMLInputElement).value).toBe('code')
    expect((container.querySelector('.root input[name=folder]') as HTMLInputElement).value).toBe('~/code')
    expect((container.querySelector('textarea[name=exclude]') as HTMLTextAreaElement).value).toBe('CHANGELOG.md')
    expect((container.querySelector('input[name=activeDays]') as HTMLInputElement).value).toBe('14')
    expect((container.querySelector('input[name=unreadDays]') as HTMLInputElement).value).toBe('30')
    expect(container.querySelector('.file')?.textContent).toContain('/home/u/.config/margin/config.json')
    const error = container.querySelector('.error') as HTMLElement
    expect(error.hidden).toBe(false)
    expect(error.textContent).toBe('folder ~/x does not exist')
  })

  it('F-07, C-01: types are a grid of name, pattern and mark; rows are added and removed and saved with the mark only when given', async () => {
    const { container, refs, save } = render(view())
    expect(container.querySelectorAll('.type')).toHaveLength(1)
    expect((container.querySelector('.type input[name=typeName]') as HTMLInputElement).value).toBe('claude')
    expect((container.querySelector('.type input[name=typeMatch]') as HTMLInputElement).value).toBe('CLAUDE.md')
    expect((container.querySelector('.type input[name=typeMark]') as HTMLInputElement).value).toBe('')
    expect((container.querySelector('.type select[name=typeColor]') as HTMLSelectElement).value).toBe('amber')
    const buttons = Array.from(container.querySelectorAll('button.add')).filter((b) => b.textContent === '+ add a type')
    expect(buttons).toHaveLength(1)
    ;(buttons[0] as HTMLButtonElement).click()
    expect(container.querySelectorAll('.type')).toHaveLength(2)
    const row = refs.typeRows[1]
    row.name.value = ' skill '
    row.match.value = '.claude/skills/*/SKILL.md'
    row.mark.value = '✦'
    expect(refs.config().types).toEqual([
      { name: 'claude', match: 'CLAUDE.md', color: 'amber' },
      { name: 'skill', match: '.claude/skills/*/SKILL.md', mark: '✦' },
    ])
    row.color.value = 'blue'
    expect(refs.config().types[1]).toEqual({ name: 'skill', match: '.claude/skills/*/SKILL.md', mark: '✦', color: 'blue' })
    row.color.value = ''
    expect(refs.config().types[1]).toEqual({ name: 'skill', match: '.claude/skills/*/SKILL.md', mark: '✦' })
    refs.typeRows[0].remove.click()
    expect(container.querySelectorAll('.type')).toHaveLength(1)
    refs.form.requestSubmit()
    await tick()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ types: [{ name: 'skill', match: '.claude/skills/*/SKILL.md', mark: '✦' }] }))
  })

  it('F-08: type suggestions show the pattern and count, leave out patterns already configured, and add a filled type row', async () => {
    const { container, refs } = render(view())
    expect(container.querySelector('.type-suggestions .loading')).not.toBeNull()
    await tick()
    const rows = container.querySelectorAll('.type-suggestion')
    expect(rows).toHaveLength(1)
    expect(rows[0].querySelector('.pattern')?.textContent).toBe('.claude/skills/*/SKILL.md')
    expect(rows[0].querySelector('.files')?.textContent).toBe('12')
    ;(rows[0].querySelector('button.add') as HTMLButtonElement).click()
    expect(refs.typeRows).toHaveLength(2)
    expect(refs.typeRows[1].name.value).toBe('skill')
    expect(refs.typeRows[1].match.value).toBe('.claude/skills/*/SKILL.md')
    expect(refs.typeRows[1].mark.value).toBe('')
    expect(container.querySelectorAll('.type-suggestion')).toHaveLength(0)
    expect(container.querySelector('.type-suggestions .none')?.textContent).toBe('No recurring file names without a type.')
    expect(refs.typeRows[1].color.value).toBe('')
  })

  it('F-08: the setup screen has no type suggestions', async () => {
    const { container } = render(view({ config: { roots: [], exclude: [], types: [], activeDays: 14, unreadDays: 30 } }))
    await tick()
    expect(container.querySelector('.type-suggestions')).toBeNull()
  })

  it('C-04: without roots it is the setup screen', () => {
    const { container } = render(view({ config: { roots: [], exclude: [], types: [], activeDays: 14, unreadDays: 30 } }))
    expect(container.querySelector('h1')?.textContent).toBe('Welcome to margin')
    expect(container.querySelector('button.primary')?.textContent).toBe('Start')
  })

  it('C-05: suggestions show with counts, a lower bound marked, and add a root with the base name', async () => {
    const { container, refs } = render(view(), {}, [
      { path: '~/notes', count: 3, partial: false },
      { path: '~/big', count: 120, partial: true },
      { path: '~/code', count: 9, partial: false },
    ])
    expect(container.querySelector('.suggestions .loading')).not.toBeNull()
    await tick()
    const rows = container.querySelectorAll('.suggestion')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.path')?.textContent).toBe('~/notes')
    expect(rows[0].querySelector('.files')?.textContent).toBe('3')
    expect(rows[1].querySelector('.files')?.textContent).toBe('≥120')
    ;(rows[0].querySelector('button.add') as HTMLButtonElement).click()
    expect(refs.rows).toHaveLength(2)
    expect(refs.rows[1].name.value).toBe('notes')
    expect(refs.rows[1].folder.value).toBe('~/notes')
    expect(container.querySelectorAll('.suggestion')).toHaveLength(1)
  })

  it('C-06: typing a folder completes it and sets the name until the name is edited', async () => {
    const { refs, complete } = render(view())
    const row = refs.addRoot({ name: '', path: '' }, false)
    row.folder.value = '~/n'
    row.folder.dispatchEvent(new Event('input'))
    expect(row.name.value).toBe('n')
    await tick()
    expect(complete).toHaveBeenCalledWith('~/n')
    const list = row.row.querySelector('datalist')!
    expect(Array.from(list.options).map((o) => o.value)).toEqual(['~/notes'])
    row.name.value = 'mine'
    row.name.dispatchEvent(new Event('input'))
    row.folder.value = '~/notes'
    row.folder.dispatchEvent(new Event('input'))
    expect(row.name.value).toBe('mine')
  })

  it('C-07, C-02: saving sends the form as a config; a refused save shows the message', async () => {
    const { container, refs, save } = render(view())
    ;(container.querySelector('textarea[name=exclude]') as HTMLTextAreaElement).value = 'a.md\n\n gen/*.md '
    ;(container.querySelector('input[name=activeDays]') as HTMLInputElement).value = '7'
    refs.form.dispatchEvent(new Event('submit'))
    await tick()
    expect(save).toHaveBeenCalledWith({ roots: [{ name: 'code', path: '~/code' }], exclude: ['a.md', 'gen/*.md'], types: [{ name: 'claude', match: 'CLAUDE.md', color: 'amber' }], activeDays: 7, unreadDays: 30 })
    save.mockRejectedValueOnce(new Error('name "code" is used twice'))
    refs.form.dispatchEvent(new Event('submit'))
    await tick()
    const error = container.querySelector('.error') as HTMLElement
    expect(error.hidden).toBe(false)
    expect(error.textContent).toBe('name "code" is used twice')
  })

  it('C-01: removing a root takes it out of the grid', () => {
    const { container, refs } = render(view())
    refs.rows[0].remove.click()
    expect(container.querySelectorAll('.root')).toHaveLength(0)
    expect(refs.config().roots).toEqual([])
  })
})
