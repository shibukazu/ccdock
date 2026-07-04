/**
 * macOS Ghostty integration, scoped to two purposes:
 *   1. Resolving the sidebar's own Ghostty window (self-identification via an
 *      OSC-set title), so window.ts can position itself reliably.
 *   2. Opening a scratch, unmanaged Ghostty window on demand (`t` key).
 * ccdock does not track, position, or close any other Ghostty window.
 */

import { escapeAppleScriptString, runOsascript } from "./applescript.ts";

export interface TerminalWindow {
	/** Scripting-side stable window id (e.g. "tab-group-a65e59360"). */
	id: string;
	/** Window title, used to bridge to the System Events AX window. */
	name: string;
	/** Working directory of the focused terminal of the selected tab. */
	workingDirectory: string;
}

const FIELD_SEP = "<<F>>";
const ROW_SEP = "<<R>>";

async function isTerminalRunning(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["pgrep", "-x", "ghostty"], { stdout: "ignore", stderr: "ignore" });
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Capture the Ghostty window id of ccdock's own terminal. Call once at startup.
 * When `sidebarTitle` is given (a unique title the sidebar set on its own
 * terminal via OSC), the window is resolved by that title — reliable even when
 * ccdock is restarted while another Ghostty window is frontmost. Falls back to
 * the front window. Returns null when ccdock is not running inside Ghostty.
 */
export async function getSidebarGhosttyWindowId(sidebarTitle?: string): Promise<string | null> {
	if (!(await isTerminalRunning())) return null;
	if (sidebarTitle) {
		const byTitle = (await listTerminalWindows(null)).find((w) => w.name === sidebarTitle);
		if (byTitle) return byTitle.id;
	}
	try {
		const result = await runOsascript(`
tell application "Ghostty"
	try
		return id of front window as string
	on error
		return ""
	end try
end tell
`);
		return result.length > 0 ? result : null;
	} catch {
		return null;
	}
}

/**
 * List all Ghostty windows with their id / name / working directory, excluding
 * the sidebar's own window (excludeId). The working directory is read from the
 * focused terminal of each window's selected tab.
 */
export async function listTerminalWindows(excludeId: string | null): Promise<TerminalWindow[]> {
	if (!(await isTerminalRunning())) return [];
	try {
		const result = await runOsascript(`
set rows to {}
tell application "Ghostty"
	repeat with w in windows
		set wid to ""
		set wname to ""
		set wdir to ""
		try
			set wid to (id of w) as string
		end try
		try
			set wname to (name of w) as string
		end try
		try
			set wdir to (working directory of (focused terminal of (selected tab of w))) as string
		end try
		set row to wid & "${FIELD_SEP}" & wname & "${FIELD_SEP}" & wdir
		copy row to end of rows
	end repeat
end tell
set savedDelim to AppleScript's text item delimiters
set AppleScript's text item delimiters to "${ROW_SEP}"
set joined to rows as text
set AppleScript's text item delimiters to savedDelim
return joined
`);
		if (!result) return [];
		const excluded = excludeId ?? "";
		return result
			.split(ROW_SEP)
			.filter((row) => row.length > 0)
			.map((row) => {
				const [id = "", name = "", dir = ""] = row.split(FIELD_SEP);
				return { id, name, workingDirectory: dir };
			})
			.filter((w) => w.id.length > 0 && w.id !== excluded);
	} catch (err) {
		if (process.env.CCDOCK_DEBUG) {
			process.stderr.write(`[listTerminalWindows] error=${String(err)}\n`);
		}
		return [];
	}
}

/**
 * Resolve the current title of a Ghostty window given its scripting-side id.
 * Titles change as the user navigates, so we look this up at call time rather
 * than caching it. Returns null when the id is unknown or unset.
 */
export async function ghosttyWindowNameForId(windowId: string | null): Promise<string | null> {
	if (!windowId) return null;
	try {
		const escapedId = escapeAppleScriptString(windowId);
		const result = await runOsascript(`
tell application "Ghostty"
	try
		return (name of window id "${escapedId}") as string
	on error
		return ""
	end try
end tell
`);
		return result.length > 0 ? result : null;
	} catch {
		return null;
	}
}

/**
 * Open a brand-new, unmanaged Ghostty window at `dir`. Fire-and-forget: no
 * polling, no tracking, no positioning. The window is entirely the user's
 * responsibility once opened.
 */
export async function openScratchTerminal(dir: string): Promise<void> {
	const escapedPath = escapeAppleScriptString(dir);
	try {
		await runOsascript(`
tell application "Ghostty"
	activate
	new window with configuration {initial working directory:"${escapedPath}"}
end tell
`);
	} catch {
		// Ghostty unavailable
	}
}
