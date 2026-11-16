import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__todo__todo'
const PANE = {
  plugin: 'todo', component: 'Pane', requestId: 'todo', surface: 'desktop',
  props: { title: 'To-do', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function world(on: any, store?: Record<string, unknown>) {
  mock.store(on, store)
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('command.register', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
}

const UP_NEXT = ['Book the dentist', 'Buy groceries', 'Call the bank', 'Water the plants', 'Review the draft']

test('"make an Up next list" fills the pane', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r: any = await $.tool.call({ tool: TOOL, action: 'replace', title: 'Up next', items: UP_NEXT } as any)
  expect(r.result).toContain('Up next:\n1. [ ] Book the dentist')
  expect(r.result).toContain('5. [ ] Review the draft')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.drawn()
    expect((await ui.find({ type: 'Text', text: /^Up next$/ }))?.text).toBe('Up next')
    expect((await ui.find({ type: 'Button', key: 't:5' }))?.text).toContain('Review the draft')
    await ui.unmount()
  }
})

test('checking off, adding, removing and clearing', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: TOOL, action: 'replace', title: 'Up next', items: UP_NEXT } as any)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 't:2' })
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
  expect((await ui.find({ type: 'Button', key: 't:2' }))?.text).toContain('☑')
  expect((await ui.find({ type: 'Text', text: /1 of 5 done/ }))).toBeTruthy()

  let r: any = await $.tool.call({ tool: TOOL, action: 'add', items: ['review this'] } as any)
  expect(r.result).toContain('6. [ ] review this')
  r = await $.tool.call({ tool: TOOL, action: 'done', numbers: [1, 9] } as any)
  expect(r.result).toContain('1. [x] Book the dentist')
  expect(r.result).toContain('No item 9: skipped.')
  r = await $.tool.call({ tool: TOOL, action: 'clear_done' } as any)
  expect(r.result).toBe('Up next:\n1. [ ] Call the bank\n2. [ ] Water the plants\n3. [ ] Review the draft\n4. [ ] review this')
  r = await $.tool.call({ tool: TOOL, action: 'remove' } as any)
  expect(r.deny).toContain('Give the item numbers to remove')
  await ui.unmount()
})

test('the list from an earlier chat is there in a new one', async ($, on) => {
  world(on, { list: { title: 'Up next', items: [{ id: 1, text: 'run this plan', done: false }], nextId: 2 } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r: any = await $.tool.call({ tool: TOOL, action: 'show' } as any)
  expect(r.result).toBe('Up next:\n1. [ ] run this plan')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Button', key: 't:1' }))?.text).toContain('run this plan')
  await ui.unmount()
})

test('Claude first, each group numbered from 1', async ($, on) => {
  world(on, { list: { title: 'Up next', items: [{ id: 1, text: 'old item', done: false }], nextId: 2 } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let r: any = await $.tool.call({ tool: TOOL, action: 'show' } as any)
  expect(r.result).toBe('Up next:\n1. [ ] old item')
  r = await $.tool.call({ tool: TOOL, action: 'replace', items: ['Approve the plan', 'Sign the form'], claude_items: ['Review the draft'] } as any)
  expect(r.result).toBe('Up next:\nWaiting on Claude (group "claude"):\n1. [ ] Review the draft\nWaiting on you (group "you"):\n1. [ ] Approve the plan\n2. [ ] Sign the form')
  r = await $.tool.call({ tool: TOOL, action: 'done', numbers: [1] } as any)
  expect(r.deny).toContain('say which group')
  r = await $.tool.call({ tool: TOOL, action: 'done', numbers: [2], group: 'you' } as any)
  expect(r.result).toContain('2. [x] Sign the form')
  r = await $.tool.call({ tool: TOOL, action: 'assign', numbers: [1], group: 'you', who: 'claude' } as any)
  expect(r.result).toContain('Waiting on Claude (group "claude"):\n1. [ ] Review the draft\n2. [ ] Approve the plan\nWaiting on you (group "you"):\n1. [x] Sign the form')

  const ui = await $.ui.mount(PANE)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Waiting on Claude' })).toBeTruthy()
  await ui.press({ key: 'm:2' })
  for (let i = 0; i < 10; i++) await new Promise(res => setTimeout(res, 0))
  r = await $.tool.call({ tool: TOOL, action: 'show' } as any)
  expect(r.result).toBe('Up next:\nWaiting on Claude (group "claude"):\n1. [ ] Review the draft\nWaiting on you (group "you"):\n1. [x] Sign the form\n2. [ ] Approve the plan')
  await ui.unmount()
})
