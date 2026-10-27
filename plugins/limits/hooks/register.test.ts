import { test, expect, mock } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { barSvg, DEBRIEF, dotColor, lastExchange, levelsOf, resetText, textBar, VOICE, wholeSession } from './register'

const USAGE = {
  rateLimits: [
    { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-20T20:10:00Z' },
    { kind: 'seven_day', percentUsed: 63, resetsAt: '2026-10-25T16:00:00Z' },
  ],
  context: { window: 200000, percent: 37 },
} as never

const BAND = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 140, scroll: { offset: 0 }, view: {} }

test('levels pick session, week and context', () => {
  expect(levelsOf(USAGE)).toEqual({ session: 12, week: 63, context: 37, sessionReset: '2026-10-20T20:10:00Z', weekReset: '2026-10-25T16:00:00Z' })
})

test('dot goes green, yellow, red', () => {
  expect(dotColor(59)).toBe('#639922')
  expect(dotColor(60)).toBe('#EF9F27')
  expect(dotColor(85)).toBe('#E24B4A')
})

test('bars fill by share and never overflow', () => {
  expect(barSvg(0)).not.toContain('#378ADD')
  expect(barSvg(50)).toContain('width="40"')
  expect(barSvg(140)).toContain('width="80" height="4" rx="2" fill="#378ADD"')
  expect(textBar(63)).toBe('▰▰▰▱▱')
})

test('the HUD shows both bars, the context circle and the buttons, on desktop and terminal', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-20T16:00:00Z') })
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => (t.ui.resolve(e as never) as never as { Box: (p: object) => never }).Box({ key: 'others' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.cwd', () => ({ value: '/Users/me/Projects/Wedding App' }) as never)
  on('process.run', (_t, e) => ({
    value: { exitCode: 0, stderr: '', stdout: (e as { argv: string[] }).argv.includes('rev-parse') ? 'security-lab\n' : ' M a.ts\n?? b.ts\n' },
  }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)

  const desk = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND } as never)
  const alts = (await desk.findAll({ type: 'Svg' })).map(svg => svg.props.alt)
  expect(alts).toContain('5h 12% used')
  expect(alts).toContain('wk 63% used')
  expect(alts).toContain('context 37%')
  expect(await desk.find({ text: /^37%$/ })).toBeDefined()
  expect(await desk.find({ text: /context/ })).toBeUndefined()
  expect(alts).toContain('5h level')
  expect(await desk.find({ key: 'plain' })).toBeDefined()
  expect(await desk.find({ key: 'catchup' })).toBeDefined()
  expect(await desk.find({ key: 'debrief' })).toBeDefined()
  expect(await desk.find({ key: 'compact' })).toBeDefined()
  expect(await desk.find({ text: /security-lab/ })).toBeUndefined()
  await desk.unmount()

  const term = await $.ui.mount({ plugin: 'limits', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  expect(await term.find({ text: /🟢 5h ▰▱▱▱▱ 12%.*🟡 wk ▰▰▰▱▱ 63%.*◔ 37%/ })).toBeDefined()
  expect(await term.find({ key: 'plain' })).toBeDefined()
  await term.unmount()
})

test('Catch me up puts the answer in the side panel', async ($, on) => {
  const talk: SessionMessage[] = [{ role: 'user', text: 'fix it', toolUses: [] }, { role: 'assistant', text: 'Fixed', toolUses: [] }]
  mock.clock(on, { now: Date.parse('2026-10-20T16:00:00Z') })
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => (t.ui.resolve(e as never) as never as { Box: (p: object) => never }).Box({ key: 'others' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.cwd', () => ({ value: '/Users/me/Projects/Wedding App' }) as never)
  on('process.run', (_t, e) => ({
    value: { exitCode: 0, stderr: '', stdout: (e as { argv: string[] }).argv.includes('rev-parse') ? 'security-lab\n' : ' M a.ts\n?? b.ts\n' },
  }) as never)
  on('session.messages', () => ({ value: talk }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'We fixed it.', usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)

  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND } as never)
  await band.press({ key: 'catchup' })
  const pane = await $.ui.mount({
    plugin: 'limits',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'hud-explain',
    props: { title: 'Catch me up', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)
  expect(await pane.find({ text: /We fixed it/ })).toBeDefined()
})

test('helpers keep his voice and pick the right slice of talk', () => {
  expect(VOICE).toContain('No em dashes')
  const msgs: SessionMessage[] = [
    { role: 'user', text: 'old', toolUses: [] },
    { role: 'user', text: 'new', toolUses: [] },
    { role: 'assistant', text: 'done', toolUses: [] },
  ]
  expect(lastExchange(msgs)).toBe('ME: new\n\nCLAUDE: done')
  expect(wholeSession(msgs, 20)).not.toContain('old')
})

test('hover text says how long until each reset', () => {
  const now = Date.parse('2026-10-20T16:00:00Z')
  expect(resetText('2026-10-20T20:10:00Z', now)).toBe('resets in 4h 10m')
  expect(resetText('2026-10-20T16:45:00Z', now)).toBe('resets in 45m')
  expect(resetText('2026-10-25T16:00:00Z', now)).toBe('resets in 5d 0h')
  expect(barSvg(12, 'resets in 4h 10m')).toContain('<title>resets in 4h 10m</title>')
})

test('Debrief sends his debrief request to Claude, and it asks before writing', async ($, on) => {
  let sent = ''
  mock.clock(on, { now: Date.parse('2026-10-20T16:00:00Z') })
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => (t.ui.resolve(e as never) as never as { Box: (p: object) => never }).Box({ key: 'others' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.cwd', () => ({ value: '/tmp/RRF' }) as never)
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo' } }) as never)
  on('prompt.submit', (_t, e) => {
    sent = (e as { text: string }).text
    return { text: sent } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND } as never)
  await band.press({ key: 'debrief' })
  expect(sent).toBe(DEBRIEF)
  expect(sent).toContain('wait for my OK')
})

test('Compact runs a compact, and says why when it is skipped', async ($, on) => {
  let compacts = 0
  let busy = false
  const toasts: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-20T16:00:00Z') })
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_t, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => (t.ui.resolve(e as never) as never as { Box: (p: object) => never }).Box({ key: 'others' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.compact', () => {
    if (busy) return { skip: 'a turn is running' } as never
    compacts += 1
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND } as never)
  await band.press({ key: 'compact' })
  expect(compacts).toBe(1)
  busy = true
  await band.press({ key: 'compact' })
  expect(compacts).toBe(1)
  expect(toasts.join(' ')).toContain('a turn is running')
})

test('only the working button lights up and says Working', async ($, on) => {
  let finish: (v: unknown) => void = () => {}
  mock.clock(on, { now: Date.parse('2026-10-20T16:00:00Z') })
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => (t.ui.resolve(e as never) as never as { Box: (p: object) => never }).Box({ key: 'others' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'hi', toolUses: [] }] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('model.complete', () => new Promise(r => (finish = r)) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND } as never)
  const pressed = band.press({ key: 'catchup' })
  await new Promise(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(null), 50))
  const catchup = await band.find({ key: 'catchup' })
  const plain = await band.find({ key: 'plain' })
  expect(catchup?.props.label).toBe('Working…')
  expect(catchup?.props.variant).toBe('primary')
  expect(plain?.text).toBe('Plain English ›')
  expect(plain?.props.variant).toBeUndefined()
  finish({ value: { isAnswered: true, text: 'done', usage: { input_tokens: 1, output_tokens: 1 } } })
  await pressed
  expect((await band.find({ key: 'catchup' }))?.text).toBe('Catch me up ›')
  expect((await band.find({ key: 'catchup' }))?.props.variant).toBeUndefined()
})

test('buttons are pills in order, with a divider and red carets on the panel ones', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-20T16:00:00Z') })
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => (t.ui.resolve(e as never) as never as { Box: (p: object) => never }).Box({ key: 'others' }))
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND } as never)
  const order = (await band.findAll({ type: 'Button' })).map(b => b.key)
  expect(order).toEqual(['compact', 'debrief', 'plain', 'catchup'])
  for (const b of await band.findAll({ type: 'Button' })) expect(b.props.plain).toBeUndefined()
  expect(await band.find({ text: '│' })).toBeDefined()
  const carets = (await band.findAll({ text: /›/ })).filter(t => t.type === 'Text')
  expect(carets.length).toBe(2)
  for (const c of carets) expect(c.props.color).toBe('#E24B4A')
  expect((await band.find({ key: 'plain' }))?.text).toContain('Plain English')
})
