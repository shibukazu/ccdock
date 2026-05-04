#!/usr/bin/env bun
import { handleHook } from "./agent/hook.ts";
import { runSidebar } from "./sidebar.ts";
import pkg from "../package.json" with { type: "json" };

function printVersion(): void {
	console.log(`ccdock ${pkg.version}`);
}

function printHelp(): void {
	const help = `
ccdock - TUI sidebar for managing git worktree development sessions

USAGE:
  ccdock [command]

COMMANDS:
  start       Start the sidebar TUI (default)
  hook        Handle agent hook events (called by Claude Code hooks)
  version     Show version number
  help        Show this help message

HOOK USAGE:
  ccdock hook <agent-type> <event-name>

  Agent types: claude-code, codex
  Events: PreToolUse, PostToolUse, PermissionRequest, Stop, Notification, SessionEnd

KEYBINDINGS (sidebar):
  j/k         Navigate sessions
  Enter/Tab   Focus editor window for selected session
  n           Create new session (wizard)
  d           Delete session
  w           Close editor window only (keep session)
  r           Realign all VS Code windows
  c           Toggle compact mode
  l           Toggle activity log
  q/Ctrl+C    Quit sidebar

CONFIG:
  ~/.config/ccdock/config.json

STATE:
  ~/.local/state/ccdock/
`.trim();

	console.log(help);
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);

	switch (command) {
		case "start":
		case undefined:
			await runSidebar();
			break;
		case "hook":
			await handleHook(args[0] ?? "claude-code", args[1] ?? "unknown");
			break;
		case "version":
		case "--version":
		case "-v":
			printVersion();
			break;
		case "help":
		case "--help":
		case "-h":
			printHelp();
			break;
		default:
			console.error(`Unknown command: ${command}`);
			printHelp();
			process.exit(1);
	}
}

await main();
