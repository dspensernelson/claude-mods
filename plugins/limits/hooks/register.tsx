import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage, SessionMeasureInput } from 'claude-code'

import type { Levels, Mode } from '../types'

// ---- Usage numbers -------------------------------------------------------

const EMPTY: Levels = { session: null, week: null, context: null, sessionReset: null, weekReset: null }
const levels = atom({ plugin: 'limits', key: 'levels' } as const, EMPTY)

type Usage = Pick<SessionMeasureInput, 'rateLimits' | 'context'>

export const levelsOf = (u: Usage): Levels => {
  const session = u.rateLimits.find(r => r.kind === 'five_hour')
  const week = u.rateLimits.find(r => r.kind === 'seven_day')
  return {
    session: session?.percentUsed ?? null,
    week: week?.percentUsed ?? null,
    context: u.context.percent ?? null,
    sessionReset: session?.resetsAt ?? null,
    weekReset: week?.resetsAt ?? null,
  }
}

// Hover text for a bar: "resets in 4h 12m", "resets in 5d 3h". Relative, so no time zone to get wrong
export const resetText = (iso: string | null, now: number) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return `resets in ${d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}`
}

// ---- Compact -----------------------------------------------------------

const compacting = atom({ plugin: 'limits', key: 'compacting' } as const, false)

// Same as typing /compact. The app refuses while Claude is mid-reply, so say so
const compact = async ($: EngineInterface) => {
  if (await read($, compacting)) return
  await update($, compacting, () => true)
  try {
    const result = await $.session.compact()
    if ('skip' in result && result.skip) $.ui.toast(`Compact skipped: ${result.skip}`)
  } catch {
    $.ui.toast('Compact works between replies. Try again when Claude is done.')
  } finally {
    await update($, compacting, () => false)
  }
}

// ---- Debrief -------------------------------------------------------------

// What the Debrief button asks Claude, in Spenser's words
export const DEBRIEF = [
  'Debrief this session.',
  'List what we decided, what we learned, and any corrections I made.',
  "For each, say where it belongs (the project's CLAUDE.md, a memory file, or nowhere) and show me the exact wording.",
  "Don't write anything yet; wait for my OK. Never write a rule I did not explicitly agree to.",
].join(' ')

// Green under 60, yellow 60 to 84, red 85 and up
export const dotColor = (p: number) => (p >= 85 ? '#E24B4A' : p >= 60 ? '#EF9F27' : '#639922')
export const dotEmoji = (p: number) => (p >= 85 ? '🔴' : p >= 60 ? '🟡' : '🟢')

const clamp = (p: number) => Math.max(0, Math.min(100, p))
const pct = (p: number) => `${Math.round(p)}%`

// ---- Drawings (desktop draws SVG; the terminal gets text) ----------------

const BAR_W = 80
const BLUE = '#378ADD'
const CARET = '#E24B4A'
const TRACK = '#88878055'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export const barSvg = (p: number, tip = '') => {
  const w = Math.round((BAR_W * clamp(p)) / 100)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="8" viewBox="0 0 ${BAR_W} 8">${tip ? `<title>${escape(tip)}</title>` : ''}<rect x="0" y="2" width="${BAR_W}" height="4" rx="2" fill="${TRACK}"/>${w > 0 ? `<rect x="0" y="2" width="${Math.max(w, 4)}" height="4" rx="2" fill="${BLUE}"/>` : ''}</svg>`
}

export const dotSvg = (p: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${dotColor(p)}"/></svg>`

export const ringSvg = (p: number) => {
  const r = 6
  const c = 2 * Math.PI * r
  const on = (c * clamp(p)) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.5"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="#B4B2A9" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${on.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 8 8)"/></svg>`
}

// Five-cell text bar for the terminal: 42 -> ▰▰▱▱▱
export const textBar = (p: number) => {
  const filled = Math.max(0, Math.min(5, Math.round(p / 20)))
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled)
}

// ---- Plain English and Catch me up ---------------------------------------

const PANE = 'hud-explain'
const MODEL = 'haiku'
const SESSION_BUDGET = 60_000
const TOOL_TEXT = 300

const answer = atom({ plugin: 'limits', key: 'answer' } as const, null)

// Spenser's voice: how every explanation should read
export const VOICE = [
  'Explain like I am smart but not a programmer.',
  'Short sentences. No jargon; if a technical word is unavoidable, define it in a few words.',
  'Lead with what it means for me, then how.',
  'No em dashes.',
].join(' ')

const ASK: Record<Mode, string> = {
  plain:
    'Below is the last exchange between me and Claude, my coding assistant. Re-explain what Claude said and did, in plain English. Keep it under 150 words. Do not add advice Claude did not give.',
  catchup:
    'Below is my whole session with Claude, my coding assistant. Catch me up in three short parts: What we did, Where we are now, What happens next. Under 200 words in all. Do not add advice Claude did not give.',
}

const TITLE: Record<Mode, string> = { plain: 'Plain English', catchup: 'Catch me up' }

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

// One message as plain lines: who said it, and the tools used, briefly
const lineOf = (m: SessionMessage) => {
  const parts: string[] = []
  if (m.text.trim()) parts.push(`${m.role === 'user' ? 'ME' : 'CLAUDE'}: ${m.text.trim()}`)
  for (const t of m.toolUses) parts.push(`CLAUDE used ${t.tool}: ${clip(JSON.stringify(t.input), TOOL_TEXT)}`)
  return parts.join('\n')
}

// A real prompt from me, not a tool result the engine filed under "user"
const isMyPrompt = (m: SessionMessage | undefined) =>
  m !== undefined && m.role === 'user' && m.text.trim() !== '' && !m.toolResults?.length

// From my last prompt to the end
export const lastExchange = (messages: readonly SessionMessage[]) => {
  let start = messages.length - 1
  while (start > 0 && !isMyPrompt(messages[start])) start -= 1
  return messages.slice(Math.max(0, start)).map(lineOf).filter(Boolean).join('\n\n')
}

// The whole session, oldest dropped until it fits the budget
export const wholeSession = (messages: readonly SessionMessage[], budget = SESSION_BUDGET) => {
  const lines = messages.map(lineOf).filter(Boolean)
  let total = lines.reduce((sum, l) => sum + l.length + 2, 0)
  while (lines.length > 1 && total > budget) total -= lines.shift()!.length + 2
  return lines.join('\n\n')
}

const explain = async ($: EngineInterface, mode: Mode) => {
  if ((await read($, answer))?.status === 'working') return
  await update($, answer, () => ({ mode, status: 'working', text: '' }))
  await $.ui.open({ id: PANE, title: TITLE[mode] })

  const messages = await $.session.messages()
  const talk = mode === 'plain' ? lastExchange(messages) : wholeSession(messages)
  if (!talk) {
    await update($, answer, () => ({ mode, status: 'error', text: 'Nothing to explain yet.' }))
    return
  }

  const reply = await $.model.complete({ model: MODEL, system: VOICE, prompt: `${ASK[mode]}\n\n---\n\n${talk}`, maxTokens: 800 })
  await update($, answer, () =>
    reply.isAnswered
      ? { mode, status: 'done', text: reply.text.trim() }
      : { mode, status: 'error', text: `Could not get an explanation (${reply.reason}). Try again in a moment.` },
  )
}

// ---- Hooks ---------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined)
    await update($, levels, () => EMPTY)
    const usage = await $.session.usage()
    await update($, levels, () => levelsOf(usage))
    // Backups for when another mod holds the strip
    await $.command.register({ name: 'plain', description: 'Re-explain the last answer in plain English' })
    await $.command.register({ name: 'catchup', description: 'Catch me up on this session in plain English' })
    return result
  })

  // Refresh after every turn and whenever a limit window moves
  on('session.measure', async ($, e, next) => {
    await update($, levels, () => levelsOf(e))
    return next(e)
  })

  on('command.run', { command: 'plain' }, async $ => {
    void explain($, 'plain')
    return { text: 'Explaining in the side panel.' }
  })

  on('command.run', { command: 'catchup' }, async $ => {
    void explain($, 'catchup')
    return { text: 'Catching you up in the side panel.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await read($, levels)
    const current = await read($, answer)
    // Which button is working right now, if any: that one alone lights up
    const working: 'plain' | 'catchup' | 'compact' | null =
      (await read($, compacting)) ? 'compact' : current?.status === 'working' ? current.mode : null
    // Whatever other mods drew (Reflect, a helper's progress) goes under the HUD
    const below = await next(e)

    const clock = await $.clock.now().catch(() => Date.now())
    const debrief = () => void $.prompt.submit({ text: DEBRIEF })
    const { Button, Text: Label } = $.ui.resolve(e)
    // Every action is a pill. A red caret marks the ones that answer in the right panel.
    // The one working right now is drawn as the highlighted button and says so
    const action = (key: 'plain' | 'catchup' | 'compact' | 'debrief', label: string, onPress: () => unknown, toPanel = false) =>
      working === key ? (
        <Button key={key} label="Working…" variant="primary" onPress={onPress} />
      ) : toPanel ? (
        <Button key={key} onPress={onPress}>
          {label}
          <Label color={CARET}> ›</Label>
        </Button>
      ) : (
        <Button key={key} label={label} onPress={onPress} />
      )
    const actions = [
      action('compact', 'Compact', () => compact($)),
      action('debrief', 'Debrief', debrief),
      <Label key="divider" dimColor>│</Label>,
      action('plain', 'Plain English', () => explain($, 'plain'), true),
      action('catchup', 'Catch me up', () => explain($, 'catchup'), true),
    ]

    if (e.surface === 'desktop' || e.surface === 'vscode' || e.surface === 'mobile') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      const meter = (key: string, label: string, p: number | null, reset: string | null) =>
        p === null ? null : (
          <Box key={key} flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            <Svg source={dotSvg(p)} alt={`${label} level`} width={10} height={10} />
            <Text>{label}</Text>
            <Svg source={barSvg(p, resetText(reset, clock))} alt={`${label} ${pct(p)} used`} width={BAR_W} height={8} isInteractive />
            <Text>{pct(p)}</Text>
          </Box>
        )
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" rowGap={1} width="100%">
            <Box key="levels" flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
              {meter('session', '5h', now.session, now.sessionReset)}
              {meter('week', 'wk', now.week, now.weekReset)}
              {now.context !== null && (
                <Box key="context" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
                  <Svg source={ringSvg(now.context)} alt={`context ${pct(now.context)}`} width={16} height={16} />
                  <Text dimColor>{pct(now.context)}</Text>
                </Box>
              )}
            </Box>
            <Box key="buttons" flexDirection="row" alignItems="center" gap={1} flexShrink={0} marginLeft={2}>
              {actions}
            </Box>
          </Box>
          {below}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const words = [
      now.session === null ? '' : `${dotEmoji(now.session)} 5h ${textBar(now.session)} ${pct(now.session)}`,
      now.week === null ? '' : `${dotEmoji(now.week)} wk ${textBar(now.week)} ${pct(now.week)}`,
      now.context === null ? '' : `◔ ${pct(now.context)}`,
    ].filter(Boolean)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text>{words.join('   ')}</Text>
          {actions}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text, Markdown } = $.ui.resolve(e)
    const now = await read($, answer)
    if (now === null) return <Text dimColor>Press Plain English or Catch me up.</Text>
    if (now.status === 'working') return <Text dimColor>Thinking…</Text>
    return <Markdown text={now.text} dimColor={now.status === 'error'} />
  })
}
