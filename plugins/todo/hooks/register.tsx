import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TodoItem, TodoList } from '../types'

// To-do: one list per project folder, kept across the chats in that folder.
// - Say "put X on my to-do list" and Claude calls the `todo` tool this mod gives it.
// - Each item is waiting on you or on Claude; the pane groups them that way.
// - The To-do pane shows the list; press an item to check it off.
// - /todo opens the pane.
// Each folder's list lives in this mod's store under `list:<folder>`, so chats in other
// folders never see it. Each change reads the store first, so two chats open at once in
// the same folder don't overwrite each other's edits.

const PANE = 'todo'
const TOOL = 'mcp__todo__todo'
const ACCENT = '#d97757'

/** The session's project folder, written one way: forward slashes, no trailing slash, and a Windows drive path lowercased (Windows paths ignore case). */
function folderKey(root: string): string {
  let p = root.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  if (/^[a-z]:/i.test(p)) p = p.toLowerCase()
  return p
}
/** The session's folder: `key` names its list in the store; `name`, as the folder spells it, titles a new list. */
async function folderOf($: EngineInterface): Promise<{ key: string; name: string }> {
  const root = await $.session.root()
  return { key: `list:${folderKey(root)}`, name: root.split(/[\\/]/).filter(Boolean).pop() ?? EMPTY.title }
}

type Who = TodoItem['who']
/** Group order, top to bottom. Each group is numbered from 1. */
const GROUPS: Who[] = ['claude', 'you']
const HEAD: Record<Who, string> = { you: 'Waiting on you', claude: 'Waiting on Claude' }

const EMPTY: TodoList = { title: 'To-do', items: [], nextId: 1 }
const list = atom({ plugin: 'todo', key: 'list' } as const, EMPTY, { shape: 'todo-2' })

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const asWho = (v: unknown): Who => (v === 'claude' ? 'claude' : 'you')

/** This folder's list as the store holds it now, tidied: anything malformed is dropped rather than trusted. */
async function load($: EngineInterface): Promise<TodoList> {
  const folder = await folderOf($)
  const raw = obj(await $.store.get(folder.key).catch(() => undefined))
  const items: TodoItem[] = (Array.isArray(raw.items) ? raw.items : [])
    .map(obj)
    .filter(i => typeof i.text === 'string' && typeof i.id === 'number')
    .map(i => ({ id: i.id as number, text: i.text as string, done: i.done === true, who: asWho(i.who) }))
  const maxId = items.reduce((m, i) => Math.max(m, i.id), 0)
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : folder.name,
    items,
    nextId: Math.max(typeof raw.nextId === 'number' ? raw.nextId : 1, maxId + 1),
  }
}

/** Reads the store, applies `fn`, writes it back, and redraws the pane. */
async function change($: EngineInterface, fn: (l: TodoList) => TodoList): Promise<TodoList> {
  const nextList = fn(await load($))
  await $.store.set((await folderOf($)).key, nextList)
  await update($, list, () => nextList)
  return nextList
}

/** Re-reads the store into the pane, for edits another chat made. */
async function sync($: EngineInterface) {
  const fresh = await load($)
  await update($, list, () => fresh)
}

/** Gives the chosen items to `to`, moved to the bottom of that group. */
const moveTo = (l: TodoList, ids: Set<number>, to: Who): TodoList => ({
  ...l,
  items: [...l.items.filter(i => !ids.has(i.id)), ...l.items.filter(i => ids.has(i.id)).map(i => ({ ...i, who: to }))],
})
const inGroup = (l: TodoList, w: Who): TodoItem[] => l.items.filter(i => i.who === w)
/** Both groups have items, so a bare item number could mean either. */
const twoGroups = (l: TodoList) => GROUPS.every(w => inGroup(l, w).length > 0)
/** Group headings show once anything is waiting on Claude; a list of only your items stays plain. */
const grouped = (l: TodoList) => l.items.some(i => i.who === 'claude')

/** The list as Claude reads it back after each call: numbered as the pane shows it. */
function describe(l: TodoList): string {
  if (l.items.length === 0) return `${l.title}: empty.`
  const lines = [`${l.title}:`]
  for (const w of GROUPS) {
    const rows = inGroup(l, w)
    if (rows.length === 0) continue
    if (grouped(l)) lines.push(`${HEAD[w]} (group "${w}"):`)
    rows.forEach((i, k) => lines.push(`${k + 1}. [${i.done ? 'x' : ' '}] ${i.text}`))
  }
  return lines.join('\n')
}

/** Item numbers as shown (1-based, within `group`) to ids; numbers out of range are reported, not guessed. */
function pick(l: TodoList, numbers: unknown, group: Who | undefined): { ids: Set<number>; bad: number[] } {
  const view = group ? inGroup(l, group) : GROUPS.flatMap(w => inGroup(l, w))
  const ids = new Set<number>()
  const bad: number[] = []
  for (const n of Array.isArray(numbers) ? numbers : []) {
    const item = typeof n === 'number' ? view[n - 1] : undefined
    if (item) ids.add(item.id)
    else bad.push(Number(n))
  }
  return { ids, bad }
}

const texts = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean)

/** Runs one tool call. Resolves to what Claude reads back, or throws a message for a bad call. */
async function run($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const action = String(input.action ?? '')
  const items = texts(input.items)
  const claudeItems = texts(input.claude_items)
  const who = asWho(input.who)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const before = await load($)
  const group: Who | undefined = input.group === 'you' || input.group === 'claude' ? input.group : undefined
  const needNumbers = ['done', 'undone', 'remove', 'edit', 'assign'].includes(action)
  if (needNumbers && !group && twoGroups(before))
    throw new Error(`Each group is numbered from 1: say which group the numbers are in, with group "claude" or "you".\n${describe(before)}`)
  const { ids, bad } = pick(before, input.numbers, group)
  if (needNumbers && ids.size === 0) throw new Error(`Give the item numbers to ${action}, as the list shows them.\n${describe(before)}`)
  const warn = bad.length ? `\n(No item ${bad.join(', ')}: skipped.)` : ''
  /** New items: `items` go to `who` (you unless said), `claude_items` to Claude. */
  const fresh = (l: TodoList): TodoItem[] =>
    [...items.map(text => ({ text, who })), ...claudeItems.map(text => ({ text, who: 'claude' as Who }))].map((x, k) => ({
      id: l.nextId + k,
      text: x.text,
      done: false,
      who: x.who,
    }))
  const count = items.length + claudeItems.length

  let after: TodoList
  switch (action) {
    case 'show':
      return describe(before)
    case 'add':
      if (count === 0) throw new Error('Give the items to add.')
      after = await change($, l => ({ ...l, title: title || l.title, items: [...l.items, ...fresh(l)], nextId: l.nextId + count }))
      break
    case 'replace':
      after = await change($, l => ({ title: title || l.title, items: fresh(l), nextId: l.nextId + count }))
      break
    case 'done':
    case 'undone':
      after = await change($, l => ({ ...l, items: l.items.map(i => (ids.has(i.id) ? { ...i, done: action === 'done' } : i)) }))
      break
    case 'remove':
      after = await change($, l => ({ ...l, items: l.items.filter(i => !ids.has(i.id)) }))
      break
    case 'edit': {
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      if (!text) throw new Error('Give the new text in `text`.')
      after = await change($, l => ({ ...l, items: l.items.map(i => (ids.has(i.id) ? { ...i, text } : i)) }))
      break
    }
    case 'assign':
      if (input.who !== 'you' && input.who !== 'claude') throw new Error('Say who the items wait on in `who`: "you" or "claude".')
      after = await change($, l => moveTo(l, ids, who))
      break
    case 'title':
      if (!title) throw new Error('Give the new title in `title`.')
      after = await change($, l => ({ ...l, title }))
      break
    case 'clear_done':
      after = await change($, l => ({ ...l, items: l.items.filter(i => !i.done) }))
      break
    default:
      throw new Error(`Unknown action "${action}".`)
  }
  await $.ui.open({ id: PANE, title: after.title }).catch(() => undefined)
  return `${describe(after)}${warn}`
}

const DESCRIPTION = [
  "The person's to-do list for this project folder: each folder has its own list, shared by the chats in that folder and shown in the To-do pane beside the chat. Chats in other folders have their own lists and never see this one.",
  'Use it whenever they ask to put something on, check off, change, reorder or clear their to-do list, or ask what is on it',
  '("add review this to my list", "make a to-do list called Up next with ...", "check off 2", "what\'s next?").',
  'Each item waits on someone: "you" (the person: their call, their errand, something only they can do) or "claude" (work they want you to pick up later, or that you said you would do).',
  'Keep their wording short, as a to-do line, not a sentence. Claude\'s group shows first, then the person\'s; each group is numbered from 1, so with both groups present pass `group` with the numbers. Every call answers with the list as it now stands.',
  'This is not your own plan for the current job: keep using your usual task list for that.',
].join(' ')

const SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['show', 'add', 'replace', 'done', 'undone', 'remove', 'edit', 'assign', 'title', 'clear_done'],
      description:
        "show: read the list. add: append items. replace: swap the whole list for items (to reorder, or start a new list). done/undone: check items off or back on. remove: delete items. edit: change one item's text. assign: move items to who. title: rename the list. clear_done: drop checked items.",
    },
    items: { type: 'array', items: { type: 'string' }, description: 'For add and replace: the lines waiting on `who` (the person, unless who says otherwise), in order.' },
    claude_items: { type: 'array', items: { type: 'string' }, description: 'For add and replace: lines waiting on Claude, in order. Use with items to set both groups in one call.' },
    who: { type: 'string', enum: ['you', 'claude'], description: 'Who `items` wait on (default "you", the person); for assign, who the numbered items move to.' },
    numbers: { type: 'array', items: { type: 'integer' }, description: 'For done, undone, remove, edit and assign: item numbers as the list shows them, from 1 within their group.' },
    group: { type: 'string', enum: ['claude', 'you'], description: 'Which group `numbers` count in. Needed when both groups have items.' },
    text: { type: 'string', description: 'For edit: the new text.' },
    title: { type: 'string', description: 'For title, and optionally add or replace: the list\'s name, such as "Up next".' },
  },
  required: ['action'],
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.tool.register({ name: 'todo', description: DESCRIPTION, inputSchema: SCHEMA, isDeferred: false })
    await $.command.register({ name: 'todo', description: 'Open your to-do list', immediate: true })
    await sync($).catch(() => undefined)
    return r
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    try {
      return { result: await run($, e as unknown as Record<string, unknown>) }
    } catch (err) {
      return { deny: err instanceof Error ? err.message : String(err) }
    }
  }).catch(() => ({ deny: 'The to-do list could not be changed just now. Try again.' }))

  on('command.run', { command: 'todo' }, async $ => {
    await sync($).catch(() => undefined)
    const l = await read($, list)
    await $.ui.open({ id: PANE, title: l.title })
    return { text: 'Opened your to-do list.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, list)
    const doneCount = l.items.filter(i => i.done).length
    const heads = grouped(l)

    const toggle = (id: number) => () =>
      void change($, x => ({ ...x, items: x.items.map(i => (i.id === id ? { ...i, done: !i.done } : i)) }))
    const move = (id: number, to: Who) => () => void change($, x => moveTo(x, new Set([id]), to))
    const remove = (id: number) => () => void change($, x => ({ ...x, items: x.items.filter(i => i.id !== id) }))
    const clearDone = () => void change($, x => ({ ...x, items: x.items.filter(i => !i.done) }))

    const row = (item: TodoItem, k: number) => {
      const scope = `item${item.id}`
      const other: Who = item.who === 'you' ? 'claude' : 'you'
      return (
        <Box key={`row:${item.id}`} flexDirection="row" width="100%" hover={{ scope }}>
          <Box width={4} flexShrink={0}>
            <Text dimColor>{`${k + 1}.`}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Button key={`t:${item.id}`} plain onPress={toggle(item.id)}>
              <Text color={item.done ? undefined : ACCENT}>{item.done ? '☑ ' : '☐ '}</Text>
              <Text dimColor={item.done} strikethrough={item.done}>{item.text}</Text>
            </Button>
          </Box>
          <Box flexShrink={0} flexDirection="row" display="none" hover={{ scope, display: 'flex' }}>
            <Button key={`m:${item.id}`} plain dimColor label={other === 'claude' ? '→ Claude ' : '→ You '} onPress={move(item.id, other)} />
            <Button key={`x:${item.id}`} plain dimColor label="✕" onPress={remove(item.id)} />
          </Box>
        </Box>
      )
    }

    const sections = GROUPS.map(w => {
      const rows = inGroup(l, w)
      if (rows.length === 0) return null
      const open = rows.filter(i => !i.done).length
      return (
        <Box key={`sec:${w}`} flexDirection="column" width="100%" marginTop={1}>
          {heads && (
            <Box flexDirection="row" width="100%">
              <Text bold color={w === 'claude' ? ACCENT : undefined}>{HEAD[w]}</Text>
              <Text dimColor>{open > 0 ? `  ${open} open` : '  all done'}</Text>
            </Box>
          )}
          {rows.map(row)}
        </Box>
      )
    })

    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="row" width="100%">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text bold wrap="truncate-end">{l.title}</Text>
          </Box>
          {l.items.length > 0 && <Text dimColor>{`${doneCount} of ${l.items.length} done`}</Text>}
        </Box>

        {l.items.length === 0 && (
          <Box marginTop={1} width="100%">
            <Text dimColor wrap="wrap">Nothing here yet. Tell Claude: "put review this on my to-do list".</Text>
          </Box>
        )}

        {sections}

        {doneCount > 0 && (
          <Box marginTop={1}>
            <Button key="clear" variant="secondary" label={`Clear ${doneCount} done`} onPress={clearDone} />
          </Box>
        )}
      </Box>
    )
  })
}
