/** One thing on the list. */
export type TodoItem = {
  /** Stable id: survives renumbering when items above it are removed. */
  id: number
  text: string
  done: boolean
  /** Whose move it is: the person's, or Claude's. */
  who: 'you' | 'claude'
}

/** One project folder's list, as the store keeps it (key `list:<folder>`). */
export type TodoList = {
  title: string
  items: TodoItem[]
  nextId: number
}

declare module 'claude-code' {
  interface PluginState {
    todo: {
      /** The list as last read from the store: what the pane draws. */
      list: Shaped<TodoList>
    }
  }
}
