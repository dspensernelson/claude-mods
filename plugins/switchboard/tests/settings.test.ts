import { expect, test } from 'claude-code/testing'
import type { ConfigRow } from 'claude-code'

import { commandFor, commandSettings, configSettings, storePrefix } from '../hooks/settings'

const row = (over: Partial<ConfigRow>): ConfigRow =>
  ({ key: 'x.y', label: 'Y', kind: 'boolean', value: true, provider: { plugin: 'x', tier: 'user' }, isLocked: false, ...over }) as ConfigRow

test('official settings: only the named mod, booleans as On/Off, choices as listed, text read-only', async () => {
  const rows = configSettings('filetree', [
    row({ key: 'theme', provider: { plugin: 'engine', tier: 'core' } as ConfigRow['provider'], kind: 'choice', value: 'dark', options: ['dark'] }),
    row({ key: 'filetree.follow', label: 'Follow Claude', kind: 'choice', value: 'on', options: ['on', 'off'] }),
    row({ key: 'filetree.flag', label: 'Flag', kind: 'boolean', value: false }),
    row({ key: 'filetree.open', label: 'Open with', kind: 'text', value: '' }),
    row({ key: 'other.follow', label: 'Not mine', kind: 'boolean', value: true }),
  ])
  expect(rows.map(r => r.key)).toEqual(['filetree.follow', 'filetree.flag', 'filetree.open'])
  expect(rows[0]).toMatchObject({ source: 'config', value: 'on', choices: [{ value: 'on' }, { value: 'off' }] })
  expect(rows[1]).toMatchObject({ source: 'config', isBoolean: true, value: 'false' })
  expect(rows[2]).toMatchObject({ source: 'text', choices: [] })
})

test('cache-tax: guard reads warn or refuse, with refuse when nothing is saved', async () => {
  expect(commandSettings('cache-tax', {}).find(s => s.key === 'guard')?.value).toBe('refuse')
  expect(commandSettings('cache-tax', { guard: 'warn' }).find(s => s.key === 'guard')?.value).toBe('warn')
  expect(commandFor('cache-tax', 'guard', 'refuse', 'warn')).toEqual({ command: 'cache-tax', args: 'guard warn' })
  expect(commandFor('cache-tax', 'always', 'off', 'on')).toEqual({ command: 'keepwarm', args: 'always' })
})

test('reflect-mod: its command flips, so picking the value it already has runs nothing', async () => {
  expect(commandSettings('reflect-mod', { paused: true })[0]?.value).toBe('paused')
  expect(commandFor('reflect-mod', 'paused', 'paused', 'paused')).toBeNull()
  expect(commandFor('reflect-mod', 'paused', 'running', 'paused')).toEqual({ command: 'reflect-pause', args: '' })
})

test('skins: saved prefs over its defaults, old boolean tables, a made skin kept as a choice', async () => {
  const none = commandSettings('skins', {})
  expect(none.find(s => s.key === 'skin')?.value).toBe('noir')
  expect(none.find(s => s.key === 'countdown')?.value).toBe('off')
  expect(none.find(s => s.key === 'calm')?.value).toBe('off')
  const saved = commandSettings('skins', { prefs: { skin: 'mine', tables: false, clipOutput: true, calm: { rail: true } } })
  expect(saved.find(s => s.key === 'tables')?.value).toBe('off')
  expect(saved.find(s => s.key === 'clip')?.value).toBe('on')
  expect(saved.find(s => s.key === 'calm')?.value).toBe('on')
  expect(saved.find(s => s.key === 'skin')?.choices.some(c => c.value === 'mine')).toBe(true)
  expect(commandFor('skins', 'clip', 'on', 'off')).toEqual({ command: 'skin', args: 'clip off' })
})

test('store file prefix follows the install name', async () => {
  expect(storePrefix('cache-tax@claude-code-mods')).toBe('cache-tax_claude-code-mods-')
})
