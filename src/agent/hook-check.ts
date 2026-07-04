import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface HookEntry {
	matcher?: string;
	hooks?: Array<{ type?: string; command?: string }>;
}

interface ClaudeSettings {
	hooks?: Record<string, HookEntry[]>;
}

// Detects ccdock hook commands registered in ~/.claude/settings.json whose
// executable no longer resolves. If the ccdock binary path becomes a dangling
// symlink (e.g. after a bun install/upgrade), every hook invocation exits 127
// and notifications/status updates silently stop working.
export function findBrokenHookCommands(settingsPath?: string): string[] {
	const path = settingsPath ?? join(process.env.HOME ?? "", ".claude", "settings.json");
	try {
		const settings: ClaudeSettings = JSON.parse(readFileSync(path, "utf8"));
		const broken = new Set<string>();
		for (const entries of Object.values(settings.hooks ?? {})) {
			for (const entry of entries) {
				for (const hook of entry.hooks ?? []) {
					const command = hook.command;
					if (!command || !command.includes("ccdock")) continue;
					const executable = command.split(/\s+/)[0];
					if (!executable) continue;
					const isBroken = executable.includes("/")
						? !existsSync(executable)
						: Bun.which(executable) === null;
					if (isBroken) broken.add(executable);
				}
			}
		}
		return [...broken];
	} catch {
		return [];
	}
}
