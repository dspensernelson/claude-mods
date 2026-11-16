/** One installed mod, as the pane draws it. */
export type ModRow = {
  /** The plugin id Claude Code knows it by: name@marketplace. */
  id: string
  name: string
  description: string
  /** On in your user settings: what every new chat loads. */
  global: boolean
  /** On in this chat right now. */
  here: boolean
  /** This chat's own choice, when it differs from the global one; undefined when this chat follows global. */
  chatOnly?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      rows: ModRow[]
      /** The id being switched right now, or ''. */
      busy: string
      /** One line under the list: the last result or error. */
      note: string
      /** id -> on, as the settings stood at this chat's last plugin load. */
      atStart: Record<string, boolean>
      /** id -> on: this chat's own choices, layered over the global settings at every reload. */
      chat: Record<string, boolean>
      /** Whether this app has /reload-plugins, so a switch can take hold in this chat. */
      canReload: boolean
    }
  }
}
