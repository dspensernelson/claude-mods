export type Mode = 'plain' | 'catchup'

export type Answer = {
  mode: Mode
  status: 'working' | 'done' | 'error'
  text: string
}

// The numbers the strip draws, kept from the last measure
export type Levels = {
  session: number | null
  week: number | null
  context: number | null
  sessionReset: string | null
  weekReset: string | null
}

declare module 'claude-code' {
  interface PluginState {
    limits: { levels: Levels; answer: Answer | null; compacting: boolean }
  }
}
