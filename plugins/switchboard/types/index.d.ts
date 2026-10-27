/** One installed mod, as the pane draws it. */
export type ModRow = {
  /** The plugin id Claude Code knows it by: name@marketplace. */
  id: string
  name: string
  description: string
  /** On in settings now: what the next chat will load. */
  enabled: boolean
  /** On when this chat started: what this chat has loaded. */
  enabledAtStart: boolean
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      rows: ModRow[]
      /** The id being switched right now, or ''. */
      busy: string
      /** One line under the list: the last result or error. */
      note: string
      /** id -> on, as this chat has it loaded: set at its start, then after each reload. */
      atStart: Record<string, boolean>
      /** Whether this app has /reload-plugins, so a switch can take hold in this chat. */
      canReload: boolean
    }
  }
}
