import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModRow, SettingRow } from '../types'
import { commandFor, commandSettings, configSettings, RECIPES, storePrefix } from './settings'

// Switchboard: /switchboard opens a pane with every installed mod and two switches each.
//
// - Every chat: runs Claude Code's own `claude plugin enable|disable`, the same switch
//   /plugin flips, so it changes what every new chat loads. Then /reload-plugins makes
//   this chat match.
// - This chat: Claude Code has no per-chat plugin setting, and a reload reads the user
//   settings file. So around each reload in this chat, the switchboard flips the global
//   setting of each mod this chat chose differently, lets the reload load that set, and
//   flips them straight back. The loaded mods stay loaded; new chats see your real
//   settings. Any reload in this chat, one you type included, goes through this, so a
//   later reload keeps this chat's choices. A crash in that window is repaired at the
//   next chat's start from a note kept in the store.

const PANE = 'switchboard'
const TITLE = 'Switchboard'
const ACCENT = '#d97757'
const GOOD = '#16a34a'
/** Width of each on/off column, in cells. */
const CELL = 11

const rows = atom({ plugin: 'switchboard', key: 'rows' } as const, [] as ModRow[])
const busy = atom({ plugin: 'switchboard', key: 'busy' } as const, '')
const note = atom({ plugin: 'switchboard', key: 'note' } as const, '')
const atStart = atom({ plugin: 'switchboard', key: 'atStart' } as const, {} as Record<string, boolean>)
const chat = atom({ plugin: 'switchboard', key: 'chat' } as const, {} as Record<string, boolean>)
const canReload = atom({ plugin: 'switchboard', key: 'canReload' } as const, false)
const open = atom({ plugin: 'switchboard', key: 'open' } as const, '')
const settings = atom({ plugin: 'switchboard', key: 'settings' } as const, [] as SettingRow[])

const RELOAD = 'reload-plugins'
/** Store key: global settings flipped for a reload and not yet put back, id -> the value to put back. */
const RESTORE = 'pendingRestore'
/** A pending restore younger than this may belong to a reload still running in another chat. */
const RESTORE_AFTER_MS = 60_000

let home = ''
let claudeBin = 'claude'
/** True while this module's own reload runs, so the reload hook does not layer twice. */
let layering = false

/**
 * Whether a mod may not be switched from the pane, and why.
 * Return '' to allow it, or a short reason the pane shows in place of the buttons.
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

/** id -> on, as your user settings hold it now. */
async function globalMap($: EngineInterface): Promise<Record<string, boolean>> {
  const enabled = obj(obj(await $.settings.read({ source: 'user' })).enabledPlugins)
  return Object.fromEntries(Object.entries(enabled).map(([k, v]) => [k, v === true]))
}

/** A mod is a plugin whose hooks.json lists TypeScript modules; other plugins are skills, MCP servers and the like. */
async function isMod($: EngineInterface, dir: string) {
  const hooks = obj(await readJson($, `${dir}/hooks/hooks.json`))
  return Array.isArray(hooks.modules) && hooks.modules.length > 0
}

/** Every installed mod with its global and this-chat state, sorted by name. */
async function scan($: EngineInterface): Promise<ModRow[]> {
  const installed = obj(obj(await readJson($, `${home}/.claude/plugins/installed_plugins.json`)).plugins)
  const global = await globalMap($)
  const start = await read($, atStart)
  const mine = await read($, chat)
  const out: ModRow[] = []
  for (const [id, entries] of Object.entries(installed)) {
    const entry = obj(Array.isArray(entries) ? entries[entries.length - 1] : entries)
    const dir = typeof entry.installPath === 'string' ? entry.installPath : ''
    if (!dir || !(await isMod($, dir))) continue
    const manifest = obj(await readJson($, `${dir}/.claude-plugin/plugin.json`))
    const on = global[id] === true
    const loaded = id in start ? start[id] === true : on
    const name = typeof manifest.name === 'string' ? manifest.name : id.split('@')[0] ?? id
    out.push({
      id,
      name,
      hasSettings: Object.keys(obj(manifest.userConfig)).length > 0 || name in RECIPES,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      global: on,
      here: id in mine ? mine[id] === true : loaded,
      chatOnly: id in mine ? mine[id] === true : undefined,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function refresh($: EngineInterface) {
  const list = await scan($)
  await update($, rows, () => list)
  const id = await read($, open)
  if (id) await loadSettings($, id).catch(() => undefined)
}

async function findClaude($: EngineInterface) {
  for (const p of [`${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (await $.fs.exists(p).catch(() => false)) return p
  }
  return 'claude'
}

/** Sets one mod's global setting through Claude Code's own command. Resolves to '' or the error it printed. */
async function setGlobal($: EngineInterface, id: string, on: boolean): Promise<string> {
  const r = await $.process.run([claudeBin, 'plugin', on ? 'enable' : 'disable', id])
  if (r.exitCode === 0) return ''
  return (r.stderr || r.stdout).trim().split('\n').pop() || `exit code ${r.exitCode}`
}

/**
 * Runs `reload` with this chat's own choices layered over the global settings, then
 * puts every global setting back as it was. Mods whose chat choice matches global are left alone.
 */
async function withChatLayer<T>($: EngineInterface, reload: () => Promise<T>): Promise<T> {
  const global = await globalMap($)
  const flips = Object.entries(await read($, chat)).filter(([id, on]) => (global[id] === true) !== on)
  if (flips.length === 0) return reload()
  await $.store.set(RESTORE, { at: await $.clock.now(), ids: Object.fromEntries(flips.map(([id, on]) => [id, !on])) })
  layering = true
  try {
    for (const [id, on] of flips) await setGlobal($, id, on)
    return await reload()
  } finally {
    for (const [id, on] of flips) await setGlobal($, id, !on).catch(() => '')
    await $.store.delete(RESTORE).catch(() => undefined)
    layering = false
  }
}

/** After any reload: this chat now runs the global settings, with its own choices on top. */
async function afterReload($: EngineInterface) {
  const global = await globalMap($)
  await update($, atStart, () => global)
  await refresh($).catch(() => undefined)
}

/** Reloads plugins in this chat, layered. True when it ran; false where the app has no such command or it failed. */
async function reloadNow($: EngineInterface) {
  if (!(await read($, canReload))) return false
  try {
    await withChatLayer($, () => $.command.run({ command: RELOAD }))
    await afterReload($)
    return true
  } catch {
    return false
  }
}

/** Puts back global settings a crashed reload left flipped. */
async function repairRestore($: EngineInterface) {
  const pending = obj(await $.store.get(RESTORE))
  const at = typeof pending.at === 'number' ? pending.at : 0
  if (!pending.ids || (await $.clock.now()) - at < RESTORE_AFTER_MS) return
  for (const [id, on] of Object.entries(obj(pending.ids))) await setGlobal($, id, on === true).catch(() => '')
  await $.store.delete(RESTORE)
}

async function switching($: EngineInterface, row: ModRow, work: () => Promise<void>) {
  if ((await read($, busy)) || isProtected(row)) return
  await update($, busy, () => row.id)
  try {
    await work()
  } catch (err) {
    await update($, note, () => `Could not switch ${row.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
  await refresh($).catch(() => undefined)
  await update($, busy, () => '')
}

/** The every-chat switch. This chat follows it too, dropping any choice of its own for this mod. */
function toggleGlobal($: EngineInterface, row: ModRow) {
  return switching($, row, async () => {
    const on = !row.global
    const failed = await setGlobal($, row.id, on)
    if (failed) {
      await update($, note, () => `Could not turn ${row.name} ${on ? 'on' : 'off'} everywhere: ${failed}`)
      return
    }
    const before = await read($, chat)
    await update($, chat, c => Object.fromEntries(Object.entries(c).filter(([id]) => id !== row.id)))
    if (await reloadNow($)) {
      await update($, note, () => `${row.name} is ${on ? 'on' : 'off'} in all chats, this one included.`)
    } else {
      await update($, chat, () => before)
      await update($, note, () => `${row.name} is ${on ? 'on' : 'off'} in all chats from your next one.`)
    }
  })
}

/** The this-chat switch: changes only what this chat runs. */
function toggleChat($: EngineInterface, row: ModRow) {
  return switching($, row, async () => {
    const on = !row.here
    const before = await read($, chat)
    // A choice that matches global is no choice of this chat's own: drop it.
    await update($, chat, c => {
      const next = Object.fromEntries(Object.entries(c).filter(([id]) => id !== row.id))
      return on === row.global ? next : { ...next, [row.id]: on }
    })
    if (await reloadNow($)) {
      await update($, note, () =>
        on === row.global ? `${row.name} is ${on ? 'on' : 'off'} here, matching all chats.` : `${row.name} is ${on ? 'on' : 'off'} in this chat only.`,
      )
    } else {
      await update($, chat, () => before)
      await update($, note, () => `Could not reload plugins, so ${row.name} was not switched in this chat.`)
    }
  })
}

// ---- A mod's own settings -------------------------------------------------

/** A mod's saved data, read only: the file its $.store lives in. Empty when there is none yet. */
async function storeOf($: EngineInterface, id: string): Promise<Record<string, unknown>> {
  const dir = `${home}/.claude/plugins/store`
  const prefix = storePrefix(id)
  const entries = await $.fs.list(dir).catch(() => [])
  const file = entries.find(f => f.kind === 'file' && f.name.startsWith(prefix) && f.name.endsWith('.json'))
  return file ? obj(await readJson($, `${dir}/${file.name}`)) : {}
}

/** Every setting of one mod: its official ones, then its command ones. */
async function settingsOf($: EngineInterface, row: ModRow): Promise<SettingRow[]> {
  const config = configSettings(row.name, await $.config.list().catch(() => []))
  const command = row.name in RECIPES ? commandSettings(row.name, await storeOf($, row.id)) : []
  return [...config, ...command]
}

async function loadSettings($: EngineInterface, id: string) {
  const row = (await read($, rows)).find(r => r.id === id)
  const list = row && row.here ? await settingsOf($, row) : []
  await update($, settings, () => list)
}

/** Opens a mod's settings under its row, or closes them. */
async function toggleOpen($: EngineInterface, row: ModRow) {
  const next = (await read($, open)) === row.id ? '' : row.id
  await update($, open, () => next)
  await update($, settings, () => [])
  if (next) await loadSettings($, next).catch(err => update($, note, () => `Could not read ${row.name}'s settings: ${String(err)}`))
}

/** Moves one setting to `value`, through Claude Code's settings or the mod's own command. */
async function choose($: EngineInterface, row: ModRow, s: SettingRow, value: string) {
  if ((await read($, busy)) || s.locked || s.value === value) return
  await update($, busy, () => `${row.id}:${s.key}`)
  const label = s.choices.find(c => c.value === value)?.label ?? value
  try {
    if (s.source === 'config') {
      const { deny } = await $.config.set({ key: s.key, value: s.isBoolean ? value === 'true' : value })
      await update($, note, () => (deny ? `${row.name} refused: ${deny}` : `${row.name}: ${s.label} is now ${label}, in every chat.`))
    } else if (s.source === 'command') {
      const run = commandFor(row.name, s.key, s.value, value)
      if (run) await $.command.run(run)
      await update($, note, () => `${row.name}: ${s.label} is now ${label}, in every chat.`)
    }
  } catch (err) {
    await update($, note, () => `Could not change ${row.name}'s ${s.label}: ${err instanceof Error ? err.message : String(err)}`)
  }
  await loadSettings($, row.id).catch(() => undefined)
  await update($, busy, () => '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    home = (await $.env.get('HOME')) ?? ''
    claudeBin = await findClaude($)
    await repairRestore($).catch(() => undefined)
    await $.command.register({ name: 'switchboard', description: 'Turn your mods on or off, in this chat or every chat', immediate: true })
    const commands = await $.command.list().catch(() => [])
    await update($, canReload, () => commands.some(c => c.name === RELOAD))
    // What this chat loaded: set once, so a reload of this mod keeps the chat's real starting point.
    if (Object.keys(await read($, atStart)).length === 0) {
      const global = await globalMap($)
      await update($, atStart, () => global)
    }
    await refresh($).catch(() => undefined)
    return r
  })

  // Every plugin reload in this chat, one you type included, keeps this chat's own choices.
  on('command.run', { command: RELOAD }, async ($, e, next) => {
    if (layering) return next(e)
    const r = await withChatLayer($, () => next(e))
    await afterReload($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e)) // A failure here never blocks the reload: next replays it if it already ran.

  on('command.run', { command: 'switchboard' }, async $ => {
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Opened the Switchboard.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = (await read($, rows)).filter(r => !isProtected(r))
    const working = await read($, busy)
    const last = await read($, note)
    const live = await read($, canReload)
    const openId = await read($, open)
    const openSettings = await read($, settings)
    const onHere = list.filter(r => r.here).length
    const ownChoices = list.filter(r => r.chatOnly !== undefined).length
    const waiting = list.filter(r => r.chatOnly === undefined && r.here !== r.global).length

    /** One on/off cell: a small toggle, or a mark while that mod is switching. */
    const cell = (key: string, isOn: boolean, color: string | undefined, press: () => void, isBusy: boolean) => (
      <Box width={CELL} flexShrink={0} justifyContent="center">
        {isBusy ? (
          <Text color={ACCENT}>…</Text>
        ) : (
          <Button key={key} plain dimColor={!isOn} onPress={press}>
            <Text color={isOn ? color : undefined}>{isOn ? '● On' : '○ Off'}</Text>
          </Button>
        )}
      </Box>
    )

    /** The open mod's settings, drawn under its row: a label, then one button per choice. */
    const settingsBlock = (row: ModRow) => (
      <Box key={`set:${row.id}`} flexDirection="column" width="100%" marginLeft={2} marginBottom={1}>
        {!row.here ? (
          <Text dimColor wrap="wrap">Turn this mod on in this chat to change its settings.</Text>
        ) : openSettings.length === 0 ? (
          <Text dimColor>Reading settings…</Text>
        ) : (
          <Text dimColor wrap="wrap">These settings apply to every chat.</Text>
        )}
        {row.here &&
          openSettings.map((s, i) => {
            const scope = `set${i}`
            const isBusy = working === `${row.id}:${s.key}`
            return (
              <Box key={s.key} flexDirection="column" width="100%" marginTop={1} hover={{ scope }}>
                <Text wrap="wrap">{s.label}{s.locked ? '  (set by your organization)' : ''}</Text>
                {s.source === 'text' ? (
                  <Text dimColor wrap="wrap">{`${s.value || '(empty)'}  · change in /config`}</Text>
                ) : (
                  <Box flexDirection="row" flexWrap="wrap" columnGap={2} width="100%">
                    {isBusy ? (
                      <Text color={ACCENT}>…</Text>
                    ) : (
                      s.choices.map(c => {
                        const picked = c.value === s.value
                        return (
                          <Button key={`${s.key}=${c.value}`} plain dimColor={!picked} onPress={() => void choose($, row, s, c.value)}>
                            <Text color={picked ? GOOD : undefined}>{`${picked ? '●' : '○'} ${c.label}`}</Text>
                          </Button>
                        )
                      })
                    )}
                  </Box>
                )}
                {s.description ? (
                  <Box display="none" hover={{ scope, display: 'flex' }} width="100%" overflow="hidden">
                    <Text dimColor wrap="wrap">{s.description}</Text>
                  </Box>
                ) : null}
              </Box>
            )
          })}
      </Box>
    )

    return (
      // Sized by the pane, not by a column count: a desktop's proportional font
      // makes bodyColumns overshoot, and a fixed width pushed the controls off the edge.
      <Box flexDirection="column" width="100%">
        <Text dimColor wrap="wrap">
          {list.length === 0
            ? 'No mods installed.'
            : `${onHere} of ${list.length} mods on in this chat.${live ? '' : ' This app cannot reload mods mid-chat, so changes apply from your next chat.'}`}
        </Text>

        {list.length > 0 && (
          <Box flexDirection="row" width="100%" marginTop={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text dimColor>Mod</Text>
            </Box>
            {live && (
              <Box width={CELL} flexShrink={0} justifyContent="center">
                <Text dimColor>This chat</Text>
              </Box>
            )}
            <Box width={CELL} flexShrink={0} justifyContent="center">
              <Text dimColor>All chats</Text>
            </Box>
          </Box>
        )}

        {list.map((row, i) => {
          const scope = `row${i}`
          const isBusy = working === row.id
          return (
            <Box key={row.id} flexDirection="column" width="100%">
              <Box flexDirection="row" alignItems="center" width="100%" hover={{ scope }}>
                {/* The name gives up room first; the toggles never shrink. */}
                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                  {/* A mod with settings has a ▸ before its name; pressing the name opens them. */}
                  {row.hasSettings ? (
                    <Button key={`o:${row.id}`} plain onPress={() => void toggleOpen($, row)}>
                      <Text bold={row.here} dimColor={!row.here} wrap="truncate-end" hover={{ scope, dimColor: false }}>
                        {`${openId === row.id ? '▾' : '▸'} ${row.name}`}
                      </Text>
                    </Button>
                  ) : (
                    <Text bold={row.here} dimColor={!row.here} wrap="truncate-end" hover={{ scope, dimColor: false }}>
                      {`  ${row.name}`}
                    </Text>
                  )}
                </Box>
                {live && cell(`c:${row.id}`, row.here, row.chatOnly !== undefined ? ACCENT : GOOD, () => void toggleChat($, row), isBusy)}
                {cell(`g:${row.id}`, row.global, GOOD, () => void toggleGlobal($, row), isBusy)}
              </Box>
              {row.description ? (
                <Box display="none" hover={{ scope, display: 'flex' }} width="100%" overflow="hidden">
                  <Text dimColor wrap="wrap">{row.description}</Text>
                </Box>
              ) : null}
              {openId === row.id && settingsBlock(row)}
            </Box>
          )
        })}

        {(ownChoices > 0 || waiting > 0 || last) && (
          <Box flexDirection="column" marginTop={1} width="100%">
            {ownChoices > 0 && <Text color={ACCENT} wrap="wrap">{`● ${ownChoices} set for this chat only.`}</Text>}
            {waiting > 0 && <Text color={ACCENT} wrap="wrap">{`${waiting} all-chats change${waiting === 1 ? '' : 's'} waiting for a new chat.`}</Text>}
            {last ? <Text dimColor wrap="wrap">{last}</Text> : null}
          </Box>
        )}
      </Box>
    )
  })
}
