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
  /** Whether the mod has settings of its own the pane can show. Added in 0.4.0; read with a fallback. */
  hasSettings?: boolean
}

/** One choice a setting offers. */
export type SettingChoice = {
  value: string
  label: string
}

/** One setting of a mod, as the pane draws it under the mod's row. */
export type SettingRow = {
  /** A `/config` key (`<mod>.<field>`) for an official setting; the recipe's key for a command one. */
  key: string
  label: string
  description: string
  /**
   * Where it lives: `config` is an official setting changed through Claude Code's own settings,
   * `command` is changed by running the mod's own slash command, `text` is shown but changed in /config.
   */
  source: 'config' | 'command' | 'text'
  /** True for an official on/off setting, whose values travel as booleans. */
  isBoolean: boolean
  /** The current value; '' when it cannot be told. */
  value: string
  choices: SettingChoice[]
  /** Set by a trusted source (an organization's policy): shown, not changed. */
  locked: boolean
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
      /** The id of the mod whose settings are open under its row, or ''. Added in 0.4.0. */
      open: string
      /** The open mod's settings. Added in 0.4.0. */
      settings: SettingRow[]
    }
  }
}
