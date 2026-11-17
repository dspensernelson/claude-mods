export type Mode = 'plain' | 'catchup'

export type Answer = {
  mode: Mode
  status: 'working' | 'done' | 'error'
  text: string
}

// Any limit window other than 5h and weekly, such as a company spend limit
export type OtherLimit = {
  kind: string
  percent: number
  reset: string | null
}

// The numbers the strip draws, kept from the last measure
export type Levels = {
  session: number | null
  week: number | null
  context: number | null
  sessionReset: string | null
  weekReset: string | null
  // Added in 0.5.0; a value stored by 0.4.0 has neither, so read them with a fallback
  others?: OtherLimit[]
  cost?: number | null
}

declare module 'claude-code' {
  interface PluginState {
    limits: { levels: Levels; answer: Answer | null; compacting: boolean }
  }
}
