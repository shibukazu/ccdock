import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Inject a unique window title into a worktree's `.vscode/settings.json` so
 * that VS Code window titles can be matched unambiguously even when two
 * sessions share the same branch basename across different repositories.
 *
 * The token written is `ccdock:<sessionId>`; window matching can then look
 * for that token in the title instead of the worktree basename.
 *
 * Existing settings are preserved — only `window.title` is touched, and
 * only if it is not already set (or already set by a previous ccdock run).
 */
export function writeWindowTitleMarker(worktreePath: string, sessionId: string): void {
	const dir = join(worktreePath, ".vscode");
	const file = join(dir, "settings.json");
	const token = sessionTitleToken(sessionId);
	// VS Code title template: "<rootName> — ccdock:<sessionId>"
	const desired = `\${rootName} — ${token}`;

	let existing: Record<string, unknown> = {};
	if (existsSync(file)) {
		try {
			existing = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
		} catch {
			// Malformed user settings — leave them alone.
			return;
		}
	}

	const current = existing["window.title"];
	const alreadyOurs = typeof current === "string" && current.includes(token);
	const isUnset = current === undefined || current === null || current === "";
	if (!alreadyOurs && !isUnset) {
		// User has their own title customization — don't clobber it.
		return;
	}
	if (alreadyOurs) return;

	if (!existsSync(dir)) {
		try {
			mkdirSync(dir, { recursive: true });
		} catch {
			return;
		}
	}

	const merged = { ...existing, "window.title": desired };
	try {
		writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
	} catch {
		// Read-only filesystem or similar — silently skip.
	}
}

export function sessionTitleToken(sessionId: string): string {
	return `ccdock:${sessionId}`;
}
