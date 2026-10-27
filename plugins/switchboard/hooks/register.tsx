import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModRow } from '../types'

// Switchboard: /switchboard opens a pane with every installed mod and an On/Off
// button each. A press runs Claude Code's own `claude plugin enable|disable`, the
// same switch /plugin flips, so it works for any mod without changing that mod.
// Claude Code loads plugins when a chat starts: a change applies from the next chat.

const PANE = 'switchboard'
const TITLE = 'Switchboard'
const ACCENT = '#d97757'
const GOOD = '#16a34a'

const rows = atom({ plugin: 'switchboard', key: 'rows' } as const, [] as ModRow[])
const busy = atom({ plugin: 'switchboard', key: 'busy' } as const, '')
const note = atom({ plugin: 'switchboard', key: 'note' } as const, '')
const atStart = atom({ plugin: 'switchboard', key: 'atStart' } as const, {} as Record<string, boolean>)

let home = ''
let claudeBin = 'claude'

/**
 * Whether a mod may not be switched from the pane, and why.
 * Return '' to allow it, or a short reason the pane shows in place of the button.
 */
function isProtected(row: ModRow): string {
  // Turning this mod off from its own pane would leave no pane to turn it back on.
  return row.name === 'switchboard' ? 'always on' : ''
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return undefined
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** A mod is a plugin whose hooks.json lists TypeScript modules; other plugins are skills, MCP servers and the like. */
async function isMod($: EngineInterface, dir: string) {
  const hooks = obj(await readJson($, `${dir}/hooks/hooks.json`))
  return Array.isArray(hooks.modules) && hooks.modules.length > 0
}

/** Every installed mod with its on/off state in your user settings, sorted by name. */
async function scan($: EngineInterface): Promise<ModRow[]> {
  const installed = obj(obj(await readJson($, `${home}/.claude/plugins/installed_plugins.json`)).plugins)
  const settings = obj(await $.settings.read({ source: 'user' }))
  const enabled = obj(settings.enabledPlugins)
  const start = await read($, atStart)
  const out: ModRow[] = []
  for (const [id, entries] of Object.entries(installed)) {
    const entry = obj(Array.isArray(entries) ? entries[entries.length - 1] : entries)
    const dir = typeof entry.installPath === 'string' ? entry.installPath : ''
    if (!dir || !(await isMod($, dir))) continue
    const manifest = obj(await readJson($, `${dir}/.claude-plugin/plugin.json`))
    const on = enabled[id] === true
    out.push({
      id,
      name: typeof manifest.name === 'string' ? manifest.name : id.split('@')[0] ?? id,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      enabled: on,
      enabledAtStart: id in start ? start[id] === true : on,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function refresh($: EngineInterface) {
  const list = await scan($)
  await update($, rows, () => list)
}

async function findClaude($: EngineInterface) {
  for (const p of [`${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (await $.fs.exists(p).catch(() => false)) return p
  }
  return 'claude'
}

async function toggle($: EngineInterface, row: ModRow) {
  if ((await read($, busy)) || isProtected(row)) return
  const verb = row.enabled ? 'disable' : 'enable'
  await update($, busy, () => row.id)
  try {
    const r = await $.process.run([claudeBin, 'plugin', verb, row.id])
    const said = (r.stderr || r.stdout).trim().split('\n').pop() ?? ''
    await update($, note, () => (r.exitCode === 0 ? `${row.name} is ${verb}d. It applies from your next chat.` : `Could not ${verb} ${row.name}: ${said}`))
  } catch (err) {
    await update($, note, () => `Could not ${verb} ${row.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
  await refresh($).catch(() => undefined)
  await update($, busy, () => '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    home = (await $.env.get('HOME')) ?? ''
    claudeBin = await findClaude($)
    await $.command.register({ name: 'switchboard', description: 'Turn your mods on or off (applies from the next chat)', immediate: true })
    // What this chat loaded: set once, so a reload of this mod keeps the chat's real starting point.
    if (Object.keys(await read($, atStart)).length === 0) {
      const enabled = obj(obj(await $.settings.read({ source: 'user' })).enabledPlugins)
      await update($, atStart, () => Object.fromEntries(Object.entries(enabled).map(([k, v]) => [k, v === true])))
    }
    await refresh($).catch(() => undefined)
    return r
  })

  on('command.run', { command: 'switchboard' }, async $ => {
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Opened the Switchboard.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const working = await read($, busy)
    const last = await read($, note)
    const changed = list.filter(r => r.enabled !== r.enabledAtStart).length

    return (
      // Sized by the pane, not by a column count: a desktop's proportional font
      // makes bodyColumns overshoot, and a fixed width pushed the buttons off the edge.
      <Box flexDirection="column" width="100%">
        <Text dimColor wrap="wrap">Changes apply from your next chat.</Text>
        {list.length === 0 && <Text dimColor>No mods installed.</Text>}
        {list.map(row => {
          const locked = isProtected(row)
          const pending = row.enabled !== row.enabledAtStart
          return (
            <Box key={row.id} flexDirection="column" marginTop={1} width="100%">
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} width="100%">
                {/* The name gives up room first; the button side never shrinks. */}
                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                  <Text bold wrap="truncate-end">
                    <Text color={row.enabled ? GOOD : undefined}>{row.enabled ? '● ' : '○ '}</Text>
                    {row.name}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  {locked ? (
                    <Text dimColor>{locked}</Text>
                  ) : working === row.id ? (
                    <Text color={ACCENT}>switching…</Text>
                  ) : (
                    <Button key={`t:${row.id}`} label={row.enabled ? 'Turn off' : 'Turn on'} variant={row.enabled ? 'secondary' : 'primary'} onPress={() => void toggle($, row)} />
                  )}
                </Box>
              </Box>
              {row.description ? (
                <Box width="100%" overflow="hidden">
                  <Text dimColor wrap="truncate-end">{row.description}</Text>
                </Box>
              ) : null}
              {pending ? <Text color={ACCENT}>{row.enabled ? 'On from your next chat' : 'Off from your next chat'}</Text> : null}
            </Box>
          )
        })}
        {changed > 0 && <Text color={ACCENT}>{`${changed} change${changed === 1 ? '' : 's'} waiting for a new chat.`}</Text>}
        {last ? <Text dimColor wrap="wrap">{last}</Text> : null}
      </Box>
    )
  })
}
