# Wayfarer

A session navigator extension for the [pi coding agent](https://github.com/earendil-works/pi-mono).

It improves pi's session management with:

- **Content-derived titles** — sessions get a concise title generated from the
  recent conversation, instead of showing your first (sometimes throwaway)
  prompt. Titles are regenerated as the session grows and never overwrite a name
  you set yourself with `/name`.
- **A toggleable session panel** — a left-anchored overlay listing sessions for
  the current folder (or all folders), with **stale** badges derived from each
  session's last-modified time.
- **Switch** to any session with `Enter`.
- **Summarize** the highlighted session with `s` — a compact markdown recap
  generated on demand, without leaving the panel.

> pi's TUI is single-column, so the panel is a **toggleable overlay** rendered
> on top of the transcript — not a persistent side-by-side dock (the terminal
> can't do a true split here).

## Install

Wayfarer imports pi's own runtime packages (`@earendil-works/pi-coding-agent`,
`pi-tui`, `pi-ai`), which the host provides — there are no dependencies to
install.

Point pi at the extension in one of two ways:

**A. Symlink into the auto-discovery directory** (enables `/reload`):

```bash
ln -s ~/GitLib/pi-wayfarer/src ~/.pi/agent/extensions/wayfarer
```

**B. Reference it from `~/.pi/agent/settings.json`:**

```json
{
  "extensions": ["~/GitLib/pi-wayfarer/src/index.ts"]
}
```

Then start pi (or run `/reload` if symlinked).

## Usage

| Action | How |
|--------|-----|
| Open the panel | `/wayfarer`, or the toggle shortcut (`ctrl+shift+w`) |
| Navigate | `↑` / `↓` |
| Switch to selected session | `Enter` |
| Summarize selected session | `s` |
| Toggle folder ↔ all sessions | `t` |
| Close | `Esc` (or the toggle key) |

The toggle shortcut launches the `/wayfarer` command (pi resolves it as a
command, so it adds no user turn). Switching sessions requires command context,
which is why the real entry point is the command.

Auto-titling happens in the background when pi finishes responding, throttled so
it costs at most one small model call every few turns.

## Configuration

All knobs live in [`src/config.ts`](src/config.ts):

| Setting | Default | Meaning |
|---------|---------|---------|
| `toggleKey` | `ctrl+shift+w` | Open the panel |
| `summaryKey` | `s` | Summarize selected (in panel) |
| `scopeKey` | `t` | Toggle folder ↔ all (in panel) |
| `staleDays` | `7` | Older-than-this (by `modified`) → stale badge |
| `defaultScope` | `folder` | `folder` = current dir, `all` = every project |
| `titleModel` | `undefined` | `"provider/model-id"`, or current model if unset |
| `titleFirstAtTurn` | `2` | First title after N assistant turns |
| `titleRefreshEveryTurns` | `3` | Re-title cadence afterwards |
| `titleMaxChars` | `6000` | Conversation budget sent for titling |
| `maxTitleLength` | `60` | Title length cap |
| `summaryModel` | `undefined` | Falls back to `titleModel`, then current model |
| `summaryMaxChars` | `24000` | Session-text budget sent for summaries |

After editing, run `/reload` in pi (or restart).

### Keys

Terminals cannot receive `Cmd`/`⌘`, so bindings use `ctrl` / `alt` / `shift`
combinations. Many `ctrl` combos are already taken by pi; `ctrl+shift+w` is free
by default. Adjust `toggleKey` if it clashes with your terminal.

## How it works (notes)

- Titles: `setSessionName()` on `agent_settled`, throttled by assistant-turn
  count. A `custom` session entry records our last auto-title so a human-set
  `/name` is detected and never clobbered, surviving reloads.
- Panel: `SessionManager.list(cwd)` / `listAll()` for the two scopes; staleness
  is derived from `SessionInfo.modified`. Selection returns to the command
  handler, which owns `switchSession`.
- Summary: uses `SessionInfo.allMessagesText` (already collected for the
  picker), so it never re-opens the session file.

## Type checking

The `@earendil-works/*` packages resolve at runtime from the host pi install and
are not vendored here. To type-check locally, map them via `tsconfig` `paths` to
your installed pi (see the `paths` block used during development), or `npm link`
the pi package.

## License

MIT
