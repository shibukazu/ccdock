<div align="center"><img width="216" height="216" alt="image" src="https://github.com/user-attachments/assets/0232d436-f0d9-4986-8c51-d760ea2c8109" /></div>

<div align="center">
  
# ccdock
</div>
A TUI sidebar to orchestrate VS Code windows and track Claude Code agents.

<div align="center">
<video src="https://github.com/user-attachments/assets/fed113ef-be36-4cea-9b6b-2bc9f3db1448" width="300" autoplay loop muted playsinline></video>
</div>



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
  "editor": "code"
}
```

| Key              | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `workspace_dirs` | Directories to scan for git repositories                  |
| `editor`         | Editor command: `"code"` for VS Code, `"cursor"` for Cursor |

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
| `r`          | Realign all VS Code windows             |
| `c`          | Toggle compact mode                     |
| `l`          | Toggle activity log                     |
| `q` / Ctrl+C | Quit (with option to close editors)    |
| Mouse click  | Select session                          |
| Scroll wheel | Navigate between sessions               |

### Session card states

| Card appearance | Meaning |
| --------------- | ------- |
| White border + green `●` | Editor is focused |
| Normal border + green `●` | Editor is open but not focused |
| Spinning `⠋` indicator | Editor is launching |
| Dim border, no dot | Editor is closed |

### Agent status

| Icon | Status | Description |
| ---- | ------ | ----------- |
| `●` green | running | Agent is executing tools |
| `●`/`○` yellow pulse | waiting | Awaiting user permission |
| `○` teal | idle | Agent is ready |

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
