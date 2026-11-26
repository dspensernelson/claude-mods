import type { ConfigRow } from 'claude-code'

import type { SettingChoice, SettingRow } from '../types'

// A mod's settings come two ways.
//
// - Official ones: the mod's manifest declares them (`userConfig`), and Claude Code lists them
//   through $.config with a label, help text and choices. They show up here with no code per mod.
// - Command ones: a mod that keeps its settings behind its own slash command. Each needs a recipe
//   below: the command to run for every choice, and where the mod saves the current value.
//   Switchboard only ever reads another mod's saved file. Every change goes through the mod's own
//   command, so the mod's in-memory copy stays right.

type Store = Record<string, unknown>

/** One choice of a command setting, and what to type after the command to pick it. */
type Pick = SettingChoice & { args: string }

export type Recipe = {
  key: string
  label: string
  description: string
  /** The mod's slash command, without the slash. */
  command: string
  choices: Pick[]
  /** The current choice's value, from the mod's saved data. */
  read: (store: Store) => string
}

const obj = (v: unknown): Store => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : {})
const ON_OFF = (args: (on: boolean) => string): Pick[] => [
  { value: 'on', label: 'On', args: args(true) },
  { value: 'off', label: 'Off', args: args(false) },
]

// ---- skins ---------------------------------------------------------------

/** skins' own defaults (skins 0.5.13, hooks/command.ts), for settings it has not saved yet. */
const SKIN_DEFAULTS: Store = {
  skin: 'noir', icons: 'unicode', prompt: 'left', words: 'skin', tables: 'on', calm: null,
  rail: true, shimmer: true, band: true, countdown: false, clipOutput: false, markdown: true, quiet: false,
  charts: true, math: true, commands: true, shell: true, highlight: true, hints: true, links: true,
  copy: true, fold: true, expand: false, compact: true,
}

const SKIN_NAMES = [
  'noir', 'tokyo-night', 'dracula', 'nord', 'gruvbox', 'catppuccin', 'rose-pine', 'everforest',
  'one-dark', 'solarized', 'github', 'kanagawa', 'ayu', 'night-owl', 'mono',
]

const prefs = (store: Store): Store => ({ ...SKIN_DEFAULTS, ...obj(store.prefs) })

/** skins' on/off parts: the word /skin takes, the field it saves, and what it does. */
const SKIN_PARTS: [word: string, field: string, label: string, description: string][] = [
  ['rail', 'rail', 'Tool rail', 'The coloured rail beside tool rows.'],
  ['shimmer', 'shimmer', 'Spinner shimmer', 'A band of light across the spinner word.'],
  ['band', 'band', 'Usage band', 'Usage meters above the prompt.'],
  ['countdown', 'countdown', 'Limit countdown', 'Time left on each limit in the usage band.'],
  ['clip', 'clipOutput', 'Trim shell output', 'Shows only the start and end of long shell output.'],
  ['markdown', 'markdown', 'Markdown extras', 'Alerts and task lists drawn properly.'],
  ['quiet', 'quiet', 'Quiet reads', 'Folds reads, searches and read-only commands into one row.'],
  ['charts', 'charts', 'Charts', 'Mermaid diagrams drawn as charts.'],
  ['math', 'math', 'Math', 'Math drawn as typeset formulas.'],
  ['commands', 'commands', 'Command output', 'Slash-command output as tables and cards.'],
  ['shell', 'shell', 'Shell cards', 'Shell output as a card.'],
  ['highlight', 'highlight', 'Code colours', "Code blocks coloured in the skin's colours."],
  ['hints', 'hints', 'Chart hints', 'Tells Claude that charts can be drawn here.'],
  ['links', 'links', 'Links', 'Web addresses and file paths become links.'],
  ['copy', 'copy', 'Copy buttons', 'Copy buttons on cards.'],
  ['fold', 'fold', 'Fold long blocks', 'Long blocks fold behind a "more" line.'],
  ['expand', 'expand', 'Expand groups', 'Opens every group of reads and searches.'],
  ['compact', 'compact', 'Compact button', 'The Compact button in the usage band.'],
]

const SKINS: Recipe[] = [
  {
    key: 'skin',
    label: 'Skin',
    description: 'Which look to use, or Off for Claude Code\'s own.',
    command: 'skin',
    choices: [...SKIN_NAMES.map(name => ({ value: name, label: name, args: name })), { value: 'off', label: 'Off', args: 'off' }],
    read: s => String(prefs(s).skin ?? ''),
  },
  {
    key: 'calm',
    label: 'Calm',
    description: 'No motion, one line per tool row, read-only output folded. Turning it off puts back what you had.',
    command: 'skin',
    choices: ON_OFF(on => `calm ${on ? 'on' : 'off'}`),
    read: s => (prefs(s).calm == null ? 'off' : 'on'),
  },
  {
    key: 'tables',
    label: 'Tables',
    description: 'Tables as cards, as selectable text on the desktop, or Claude Code\'s own.',
    command: 'skin',
    choices: [
      { value: 'on', label: 'Cards', args: 'tables on' },
      { value: 'text', label: 'Text', args: 'tables text' },
      { value: 'off', label: 'Off', args: 'tables off' },
    ],
    // Tables were on/off before text, so a saved true or false still reads.
    read: s => {
      const t = prefs(s).tables
      return t === true ? 'on' : t === false ? 'off' : String(t)
    },
  },
  {
    key: 'prompt',
    label: 'Prompt outline',
    description: 'In the terminal, which side your prompt\'s outline sits on, or a plain marker.',
    command: 'skin',
    choices: ['left', 'right', 'plain'].map(v => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1), args: `prompt ${v}` })),
    read: s => String(prefs(s).prompt),
  },
  {
    key: 'words',
    label: 'Spinner words',
    description: 'Whose words the spinner and the turn footer show.',
    command: 'skin',
    choices: [
      { value: 'skin', label: "Skin's", args: 'words skin' },
      { value: 'claude', label: "Claude's", args: 'words claude' },
    ],
    read: s => String(prefs(s).words),
  },
  {
    key: 'icons',
    label: 'Icons',
    description: 'The icon set. ASCII also keeps diagrams to plain characters in the terminal.',
    command: 'skin',
    choices: [
      { value: 'unicode', label: 'Unicode', args: 'icons unicode' },
      { value: 'ascii', label: 'ASCII', args: 'icons ascii' },
    ],
    read: s => String(prefs(s).icons),
  },
  ...SKIN_PARTS.map(([word, field, label, description]): Recipe => ({
    key: word,
    label,
    description,
    command: 'skin',
    choices: ON_OFF(on => `${word} ${on ? 'on' : 'off'}`),
    read: s => (prefs(s)[field] === true ? 'on' : 'off'),
  })),
]

// ---- the recipes, by mod name ---------------------------------------------

export const RECIPES: Record<string, Recipe[]> = {
  'cache-tax': [
    {
      key: 'guard',
      label: 'Cold-send guard',
      description: 'When the cache has gone cold, stop your first message once and show the price, or just show the price and send it.',
      command: 'cache-tax',
      choices: [
        { value: 'refuse', label: 'Stop once', args: 'guard refuse' },
        { value: 'warn', label: 'Just warn', args: 'guard warn' },
      ],
      read: s => (s.guard === 'warn' ? 'warn' : 'refuse'),
    },
    {
      key: 'always',
      label: 'Keep warm in every chat',
      description: 'Always: every chat keeps its cache warm for 6 hours after its last message. Warming uses some tokens. Off stops warming everywhere.',
      command: 'keepwarm',
      choices: [
        { value: 'on', label: 'Always', args: 'always' },
        { value: 'off', label: 'Off', args: 'off' },
      ],
      read: s => (s.always === true ? 'on' : 'off'),
    },
  ],
  'reflect-mod': [
    {
      key: 'paused',
      label: 'Reflect check',
      description: 'Whether reflect checks your prompts for things worth learning.',
      // This command flips the setting each time it runs, so it is only run when the choice changes.
      command: 'reflect-pause',
      choices: [
        { value: 'running', label: 'Running', args: '' },
        { value: 'paused', label: 'Paused', args: '' },
      ],
      read: s => (s.paused === true ? 'paused' : 'running'),
    },
  ],
  skins: SKINS,
}

/** A mod's command settings, with their current values read from its saved data. */
export function commandSettings(name: string, store: Store): SettingRow[] {
  return (RECIPES[name] ?? []).map(r => {
    const value = r.read(store)
    // A value the recipe does not list (a skin you made, say) still shows, as its own choice.
    const choices = r.choices.some(c => c.value === value) || !value ? r.choices : [...r.choices, { value, label: value, args: value }]
    return {
      key: r.key,
      label: r.label,
      description: r.description,
      source: 'command',
      isBoolean: false,
      value,
      choices: choices.map(({ value, label }) => ({ value, label })),
      locked: false,
    }
  })
}

/** What to run to move a command setting to `value`; null when it is already there or unknown. */
export function commandFor(name: string, key: string, current: string, value: string): { command: string; args: string } | null {
  const r = (RECIPES[name] ?? []).find(x => x.key === key)
  const pick = r?.choices.find(c => c.value === value)
  if (!r || !pick || current === value) return null
  return { command: r.command, args: pick.args }
}

/** A mod's official settings, from the rows /config lists. */
export function configSettings(name: string, rows: readonly ConfigRow[]): SettingRow[] {
  const prefix = `${name}.`
  return rows
    .filter(r => r.key.startsWith(prefix) && r.provider.plugin !== 'engine')
    .map((r): SettingRow => {
      const base = { key: r.key, label: r.label, description: r.description ?? '', locked: r.isLocked }
      if (r.kind === 'boolean') {
        return { ...base, source: 'config', isBoolean: true, value: r.value === true ? 'true' : 'false', choices: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }] }
      }
      if (r.kind === 'choice' && r.options?.length) {
        // An empty value reads as "(default)" so the button has a name.
        return { ...base, source: 'config', isBoolean: false, value: String(r.value), choices: r.options.map(o => ({ value: o, label: o || '(default)' })) }
      }
      const shown = Array.isArray(r.value) ? r.value.join(', ') : String(r.value)
      return { ...base, source: 'text', isBoolean: false, value: shown, choices: [] }
    })
}

/** The file a mod's $.store lives in starts with this: `<name>_<marketplace>-`. */
export const storePrefix = (id: string) => {
  const [name = id, market = ''] = id.split('@')
  return `${name}_${market}-`
}
