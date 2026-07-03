<div align="center"><img width="216" height="216" alt="image" src="https://github.com/user-attachments/assets/b8f4d256-6868-4534-b3bc-d5e65bdf181b" /></div>
<div align="center">
  
# ccdock

</div>
A TUI sidebar to orchestrate VS Code windows and track Claude Code / Codex agents.

<div align="center">
<video src="https://github.com/user-attachments/assets/fed113ef-be36-4cea-9b6b-2bc9f3db1448" width="300" autoplay loop muted playsinline></video>
</div>

<a href="https://orynth.dev/projects/ccdock" target="_blank" rel="noopener">
  <img src="https://orynth.dev/api/badge/ccdock?theme=light&style=default" alt="Featured on Orynth" width="260" height="80" />
</a>

## Why?

Running multiple Claude Code agents across git worktrees is powerful — but managing the VS Code windows that go with them is a nightmare. You end up Alt-Tabbing through a dozen windows, losing track of which agent is doing what, and manually arranging editors every time you switch context.

Existing "hub" tools either force you into a CLI-only workflow or require a proprietary editor. But you already have VS Code. You just need something to **keep it organized**.

ccdock sits in a narrow terminal sidebar and takes care of the rest: auto-positioning VS Code windows, tracking every Claude Code agent in real time, and letting you switch between sessions with a single click.

## Features

- **VS Code orchestration** — Auto-open, position, and switch VS Code (or Cursor) windows next to the sidebar. Click a session, and the right editor snaps into focus.
- **Real-time agent monitoring** — See exactly what each Claude Code agent is doing: which tool it's calling, what file it's reading, what command it's running.
- **Git worktree management** — Create, switch, and delete worktrees via [git-wt](https://github.com/k1LoW/git-wt) integration. Each worktree gets its own session.
- **Activity log** — Live feed of tool invocations with session numbers (#N) across all active agents.
- **Mouse + keyboard** — Click to select sessions, scroll wheel to navigate, or use vim-style `j`/`k` keys.
- **Auto-layout** — VS Code windows automatically resize and reposition when the terminal resizes.

## Requirements

- **macOS** (uses AppleScript for window management)
- [Bun](https://bun.sh/) runtime (v1.0+)
- [VS Code](https://code.visualstudio.com/) or [Cursor](https://cursor.sh/)
- [git-wt](https://github.com/k1LoW/git-wt) for worktree creation (`go install github.com/k1LoW/git-wt@latest`)
- [Ghostty](https://ghostty.org/) terminal (used for sidebar window detection)
- A terminal font with [Nerd Font](https://www.nerdfonts.com/) support (for icons)

## Install

```sh
# ccdock itself
bun install -g ccdock

# git-wt (required for worktree creation)
go install github.com/k1LoW/git-wt@latest
```

## Setup

### 1. Configure workspace directories

Edit `~/.config/ccdock/config.json` (auto-created on first run):

```json
{
  "workspace_dirs": ["~/workspace"],
  "editor": "code",
  "terminal": "ghostty",
  "sound": {
    "enabled": true,
    "permission_request": "/System/Library/Sounds/Funk.aiff",
    "notification": "/System/Library/Sounds/Glass.aiff"
  },
  "notifications": {
    "enabled": true,
    "events": ["PermissionRequest", "Notification"]
  }
}
```

| Key                        | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `workspace_dirs`           | Directories to scan for git repositories                                             |
| `editor`                   | Editor command: `"code"` for VS Code, `"cursor"` for Cursor                          |
| `terminal`                 | Work-terminal app for the `t` keybinding. Only `"ghostty"` is supported today         |
| `sound.enabled`            | Play a sound when an agent surfaces a `PermissionRequest` / `Notification`           |
| `sound.permission_request` | Sound file (afplay-compatible) for permission prompts                                |
| `sound.notification`       | Sound file for general notifications                                                 |
| `notifications.enabled`    | Pop a macOS Notification Center alert in addition to the sound                       |
| `notifications.events`     | Hook events that trigger an alert (`PermissionRequest`, `Notification`, `Stop`, ...) |

When `notifications.enabled` is on, the sound is delivered by macOS as part of the alert — the standalone `afplay` path is suppressed for that event to avoid a double-beep.

**Click-through** behavior depends on which backend ccdock can find:

- If [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) is installed (`brew install terminal-notifier`), clicking **Show** activates Ghostty (the sidebar's terminal) so ccdock comes back to the foreground.
- Otherwise ccdock falls back to `osascript display notification`. macOS attributes those alerts to Script Editor, so the **Show** button opens Script Editor — installing `terminal-notifier` is recommended for the better UX.

Override the activated app with `CCDOCK_NOTIFY_BUNDLE_ID=<bundle.id>` (e.g. `com.googlecode.iterm2` for iTerm2). Set `CCDOCK_TERMINAL_NOTIFIER=/path/to/terminal-notifier` if it lives outside the standard Homebrew prefixes.

Set `CCDOCK_SILENT=1` in the environment to mute every sound and notification regardless of config (handy for tests / quiet sessions). Other macOS system sounds live in `/System/Library/Sounds/` (Glass, Funk, Submarine, Ping, Sosumi, …).

### Fast notifications (recommended)

Claude Code can also notify you directly, without going through ccdock's hooks. In iTerm2, Ghostty, or Kitty, the `preferredNotifChannel` setting in `~/.claude/settings.json` (default `"auto"`) uses terminal OSC escape sequences (OSC 9 / 777) to pop a desktop notification instantly. Add `"preferredNotifChannel": "auto"` to `settings.json` if you want to set it explicitly.

- On Ghostty, set `desktop-notifications = true` in `~/.config/ghostty/config` (some versions default to on already).
- Over tmux, add `set -g allow-passthrough on` to `~/.tmux.conf` so the escape sequence reaches the outer terminal.

This path is faster than ccdock's hook-based notifications (`terminal-notifier`/`osascript`) since it skips spawning a hook process and registering with Notification Center. If you enable it, avoid double notifications by setting `notifications.enabled` to `false` (or trimming `notifications.events`) in `~/.config/ccdock/config.json`. ccdock's `terminal-notifier`/`osascript` path remains useful as a fallback for environments without OSC support, such as the VS Code integrated terminal.

### 2. Set up Claude Code hooks

Add to `~/.claude/settings.json` to enable agent status monitoring:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook claude-code PreToolUse" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook claude-code PostToolUse" }] }],
    "PermissionRequest": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook claude-code PermissionRequest" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook claude-code Stop" }] }],
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook claude-code Notification" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook claude-code SessionEnd" }] }]
  }
}
```

### 3. Set up Codex hooks (optional)

If you use [OpenAI Codex CLI](https://github.com/openai/codex), you can forward its lifecycle hooks to ccdock too. Tested with `codex-cli 0.123.0`.

1. Enable the under-development `codex_hooks` feature in `~/.codex/config.toml`:

   ```toml
   [features]
   codex_hooks = true
   ```

2. Create `~/.codex/hooks.json` (Codex 0.123.0 only reads hooks from this file — inline TOML hooks in `config.toml` are not wired up yet):

   ```json
   {
     "hooks": {
       "PreToolUse": [
         { "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook codex PreToolUse", "timeout": 30 }] }
       ],
       "PostToolUse": [
         { "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook codex PostToolUse", "timeout": 30 }] }
       ],
       "PermissionRequest": [
         { "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook codex PermissionRequest", "timeout": 30 }] }
       ],
       "Stop": [
         { "matcher": "", "hooks": [{ "type": "command", "command": "ccdock hook codex Stop", "timeout": 30 }] }
       ]
     }
   }
   ```

3. Restart Codex so it picks up the new configuration.

**Known limitations (upstream Codex)**

- Only `Bash`-style shell tools (`local_shell` / `shell` / `exec_command`) fire hooks reliably today. `apply_patch`, file writes, and MCP tool invocations currently do not emit `PreToolUse`/`PostToolUse` ([openai/codex#16732](https://github.com/openai/codex/issues/16732), [#17794](https://github.com/openai/codex/issues/17794)).
- `Stop` does not fire under `codex exec` ([openai/codex#18607](https://github.com/openai/codex/issues/18607)); interactive sessions are fine.
- Hooks are disabled on Windows.
- Codex does not emit `SessionEnd`. Agents in the `stopped` state (after the `Stop` hook) are preserved indefinitely so completed sessions stay visible; entries are removed when the matching session is deleted or when the agent's `cwd` no longer maps to a known session.

## Usage

```sh
ccdock          # start the sidebar TUI
ccdock help     # show help
```

### Keybindings

| Key          | Action                                  |
| ------------ | --------------------------------------- |
| `j` / `k`   | Navigate between sessions               |
| `Enter`      | Focus editor window for selected session |
| `Tab`        | Focus editor window (same as Enter)     |
| `n`          | Create new session (interactive wizard) |
| `d`          | Delete session                          |
| `t`          | Open / focus the worktree terminal (Ghostty) |
| `w`          | Close editor window (with confirmation) |
| `W`          | Close terminal window (with confirmation) |
| `r`          | Realign all editor + terminal windows   |
| `c`          | Toggle compact mode                     |
| `l`          | Toggle activity log                     |
| `q` / Ctrl+C | Quit (with option to close editors)    |
| Mouse click  | Select session                          |
| Scroll wheel | Navigate between sessions               |

### Session card states

| Card appearance | Meaning |
| --------------- | ------- |
| White border | Editor or terminal is focused |
| Normal border | Editor or terminal is open but not focused |
| Spinning `⠋` indicator | Editor is launching |
| Spinning `⠋T` badge | Terminal is launching |
| Teal `●T` badge | Terminal is open (white when focused) |
| Dim border, no badge | Editor and terminal both closed |

### Terminal windows

Pressing `t` opens (or focuses) a [Ghostty](https://ghostty.org/) terminal whose working directory is the selected session's worktree, and manages it next to the sidebar just like an editor window (position, focus, close, realign). Terminals are matched to worktrees by the shell's working directory, so same-named branches across different repositories never collide.

- The first time ccdock scripts Ghostty, macOS shows an **Automation** permission prompt ("ccdock wants to control Ghostty"). Approve it (also under System Settings → Privacy & Security → Automation) so terminal management works.
- ccdock captures its own Ghostty window at startup and never closes or repositions it — only worktree terminals are managed.
- Ghostty must be installed and available as `com.mitchellh.ghostty`. If ccdock is launched from a different terminal, terminal management is disabled gracefully.

### Agent status

| Icon | Status | Description |
| ---- | ------ | ----------- |
| `●` green | running | Agent is executing tools |
| `●`/`○` yellow pulse | waiting | Awaiting user permission |
| `○` gray | idle | Agent started but hasn't done anything yet |
| `●` teal | stopped | Agent finished its turn (Stop event received) |

## How it works

### Architecture

```
Claude Code hooks --> ccdock hook --> writes agent JSON files
                                          |
ccdock sidebar (polls every 2s) <----------+
       |
       +--> reads session + agent state files
       +--> queries VS Code windows via AppleScript
       +--> renders TUI with merged state
```

- **State** — `~/.local/state/ccdock/` stores session and agent state as JSON files
- **Hooks** — `ccdock hook` writes agent state files when Claude Code fires events
- **Window management** — AppleScript via `osascript` to position VS Code next to the sidebar
- **Wizard** — `n` key scans workspace dirs, offers create/existing/root worktree options via `git wt`

### File structure

```
src/
  main.ts              — CLI entry point
  sidebar.ts           — Main event loop, input handling
  types.ts             — Type definitions
  config/config.ts     — Config (~/.config/ccdock/)
  workspace/state.ts   — Session/agent state persistence
  workspace/editor.ts  — VS Code open/focus
  workspace/terminal.ts— Ghostty terminal open/focus/close/reposition
  workspace/window.ts  — AppleScript window management
  worktree/manager.ts  — Git worktree operations
  worktree/scanner.ts  — Repository discovery
  tui/render.ts        — Sidebar rendering
  tui/wizard.ts        — Session wizard rendering
  tui/input.ts         — Keyboard input parsing
  tui/ansi.ts          — ANSI escape codes
  agent/hook.ts        — Hook handler
```

## Development

```sh
# Clone
git clone https://github.com/shibutani/ccdock.git
cd ccdock
bun install

# Run directly
bun run dev

# Type check
bun run typecheck

# Format
bun run format

# Build standalone binary (optional)
bun run build
```

### Project structure

The project uses [Bun](https://bun.sh/) as runtime and [Biome](https://biomejs.dev/) for formatting.

- `src/main.ts` — CLI entry point, routes `start` / `hook` / `help` commands
- `src/sidebar.ts` — Main event loop: keyboard input, timers, state refresh
- `src/tui/` — Terminal UI rendering (cards, wizard, input parsing, ANSI codes)
- `src/workspace/` — File-based state, AppleScript window management, editor control
- `src/worktree/` — Git worktree operations and repository scanning
- `src/agent/` — Claude Code hook handler

### Publishing

```sh
npm publish
```

## License

MIT
