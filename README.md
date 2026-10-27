# Claude Code mods

Two small mods for [Claude Code](https://code.claude.com): add-ons that put a panel, a bar or a button inside Claude Code while you work. They need Claude Code 2.1.287 or newer in a terminal, or the Code tab of the Claude desktop app.

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

Type `/switchboard` to open a side panel listing every mod you have installed, from any source, each with a **Turn on** or **Turn off** button and its description.

It uses Claude Code's own plugin on/off setting (the same one `claude plugin enable` and `disable` change), so it works with any mod without changing that mod. After each switch it runs `/reload-plugins` for you, so **the change takes hold right away, in the chat you are in**. Where that command is not available, the change applies from your next chat instead, and the panel's top line says which you have. The Switchboard cannot switch itself off from its own panel.

## Install

At the prompt of Claude Code in a terminal:

```
/plugin install limits --marketplace dspensernelson/claude-mods
```

```
/plugin install switchboard --marketplace dspensernelson/claude-mods
```

Or from a shell:

```bash
claude plugin install switchboard --marketplace dspensernelson/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `dspensernelson/claude-mods`, then **Add plugin**.

## License

MIT. See [LICENSE](LICENSE).
