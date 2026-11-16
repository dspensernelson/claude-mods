# Claude Code mods

Three small mods for [Claude Code](https://code.claude.com): add-ons that put a panel, a bar or a button inside Claude Code while you work. They need Claude Code 2.1.287 or newer in a terminal, or the Code tab of the Claude desktop app.

## limits

A strip above the prompt box that shows how much of your plan you have used, plus four buttons:

- **5h** and **wk** bars: your 5-hour and weekly usage, with a green, yellow or red dot. Hover a bar to see when it resets.
- **Context circle**: how full this chat's memory is.
- **Compact**: the same as typing `/compact`.
- **Debrief**: asks Claude to list what you decided, learned and corrected in this chat, and where each belongs, without writing anything until you say OK.
- **Plain English**: re-explains Claude's last answer in plain words, in a side panel.
- **Catch me up**: a short summary of the whole chat in a side panel.

Plain English and Catch me up also work as `/plain` and `/catchup`. They make a small call to Claude's Haiku model, which uses a little of your plan.

The explanations follow the author's style ("smart but not a programmer", short sentences, no em dashes). To change it, edit `VOICE` near the middle of `plugins/limits/hooks/register.tsx`.

## switchboard

Type `/switchboard` to open a side panel listing every mod you have installed, from any source, as a small table with two switches per mod:

- **This chat**: turns the mod on or off in the chat you are in only. Other chats keep their own setting. A choice that differs from your usual one is marked, and the panel's footer counts them.
- **All chats**: your usual setting, used by every new chat. It is Claude Code's own plugin on/off setting (the same one `claude plugin enable` and `disable` change), so it works with any mod without changing that mod.

After each switch it runs `/reload-plugins` for you, so **the change takes hold right away**. Where that command is not available, the change applies from your next chat instead. Hover a mod's row to see its description. The Switchboard does not list itself, so it cannot switch itself off.

## todo

Your own to-do list, beside the chat, the same in every chat. Just talk to Claude:

- "Put call the bank on my to-do list."
- "Make a list called Up next with: book the dentist, review the draft."
- "Put review the draft on Claude's list." / "Move my 2 to Claude."
- "Check off Claude's 1." / "What's next?"

The **To-do** panel (or `/todo`) shows the list in two groups, **Waiting on Claude** first, then **Waiting on you**, each numbered from 1. Click an item to check it off. Hover an item to move it to the other group or delete it. **Clear done** drops the checked items.

The list is kept by Claude Code on your computer, not in any one chat, so a new chat picks up where the last one left off.

## Install

At the prompt of Claude Code in a terminal:

```
/plugin install limits --marketplace dspensernelson/claude-mods
```

```
/plugin install switchboard --marketplace dspensernelson/claude-mods
```

```
/plugin install todo --marketplace dspensernelson/claude-mods
```

Or from a shell:

```bash
claude plugin install switchboard --marketplace dspensernelson/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `dspensernelson/claude-mods`, then **Add plugin**.

## License

MIT. See [LICENSE](LICENSE).
