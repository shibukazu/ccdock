/**
 * macOS Ghostty terminal window management via AppleScript / System Events.
 *
 * Ghostty terminal identity:
 *   Ghostty's AppleScript dictionary exposes application -> window -> tab ->
 *   terminal, and each terminal reports its `working directory`. We resolve a
 *   worktree's terminal window by the working directory of the focused terminal
 *   of its selected tab, so the match is robust across same-named branches in
 *   different repositories (the cwd is the full worktree path).
 *
 * Two window-id systems coexist and are bridged by the window title (name):
 *   - Scripting side (`tell application "Ghostty"`): window `id` like
 *     "tab-group-a65e59360", used for activate/close and cwd lookups.
 *   - System Events side (`tell process "ghostty"`, lowercase): AX windows used
 *     for set position / set size, matched to scripting windows by `name`.
 *
 * The sidebar's own Ghostty window (ccdock itself runs inside Ghostty) is always
 * excluded via the caller-supplied excludeId so ccdock never closes or moves
 * itself.
 */

import { escapeAppleScriptString, runOsascript } from "./applescript.ts";
// Deferred (function-body) usage only, so the window.ts <-> terminal.ts
// import cycle is safe at module-initialization time.
import { getScreenRightEdge, getSidebarBounds } from "./window.ts";

interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

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
 * True when the terminal's working directory equals the worktree root or lies
 * inside it (prefix match with a path-separator boundary).
 */
export function terminalMatchesWorktree(win: TerminalWindow, worktreePath: string): boolean {
	if (!win.workingDirectory || !worktreePath) return false;
	const root = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;
	return win.workingDirectory === worktreePath || win.workingDirectory.startsWith(root);
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

async function findMatchingWindow(
	worktreePath: string,
	excludeId: string | null,
): Promise<TerminalWindow | null> {
	const windows = await listTerminalWindows(excludeId);
	return windows.find((w) => terminalMatchesWorktree(w, worktreePath)) ?? null;
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
 * Compute the region to the right of the sidebar. Mirrors the editor layout so
 * terminals and editors share the same target rectangle.
 */
async function computeLayout(sidebar: WindowBounds): Promise<{
	x: number;
	y: number;
	width: number;
	height: number;
}> {
	const x = sidebar.x + sidebar.width + 4; // 4px gap
	const y = sidebar.y;
	const screenRight = await getScreenRightEdge(sidebar);
	const width = Math.max(screenRight - x, 400);
	const height = sidebar.height;
	return { x, y, width, height };
}

/**
 * Position a Ghostty window (by title) to fill the area right of the sidebar.
 */
async function positionTerminalWindow(windowName: string, sidebar: WindowBounds): Promise<void> {
	if (!windowName) return;
	const { x, y, width, height } = await computeLayout(sidebar);
	try {
		const escapedName = escapeAppleScriptString(windowName);
		// Apply twice: Ghostty may clamp the requested size against the window's
		// pre-move geometry, so a second pass after it settles fixes the width.
		await runOsascript(`
tell application "System Events"
	tell process "ghostty"
		repeat 2 times
			repeat with w in every window
				if name of w is "${escapedName}" then
					set position of w to {${x}, ${y}}
					set size of w to {${width}, ${height}}
					exit repeat
				end if
			end repeat
			delay 0.2
		end repeat
	end tell
end tell
`);
	} catch {
		// Window not found or not positionable
	}
}

/**
 * Open a new Ghostty terminal in the worktree directory, wait for it to appear,
 * then position it next to the sidebar. The sidebar window (excludeId) is
 * skipped when locating the freshly opened window.
 */
export async function openTerminal(worktreePath: string, excludeId: string | null): Promise<void> {
	const escapedPath = escapeAppleScriptString(worktreePath);
	try {
		await runOsascript(`
tell application "Ghostty"
	activate
	new window with configuration {initial working directory:"${escapedPath}"}
end tell
`);
	} catch {
		// Ghostty unavailable
		return;
	}

	// Wait for the new window to appear (up to ~10s).
	let match: TerminalWindow | null = null;
	for (let i = 0; i < 20; i++) {
		await Bun.sleep(500);
		match = await findMatchingWindow(worktreePath, excludeId);
		if (match) break;
	}

	const sidebar = await getSidebarBounds(excludeId);
	if (sidebar && match) {
		await positionTerminalWindow(match.name, sidebar);
	}
}

/**
 * Bring the worktree's Ghostty window to front and position it next to the
 * sidebar. Returns false when no matching window exists.
 */
export async function focusTerminalWindow(
	worktreePath: string,
	excludeId: string | null,
): Promise<boolean> {
	const match = await findMatchingWindow(worktreePath, excludeId);
	if (!match) return false;
	try {
		const escapedId = escapeAppleScriptString(match.id);
		await runOsascript(`
tell application "Ghostty"
	activate
	try
		activate window id "${escapedId}"
	end try
end tell
`);
	} catch {
		return false;
	}
	const sidebar = await getSidebarBounds(excludeId);
	if (sidebar) {
		await positionTerminalWindow(match.name, sidebar);
	}
	return true;
}

/**
 * Close the worktree's Ghostty window (keeping the session and worktree).
 */
export async function closeTerminalWindow(
	worktreePath: string,
	excludeId: string | null,
): Promise<void> {
	const match = await findMatchingWindow(worktreePath, excludeId);
	if (!match) return;
	try {
		const escapedId = escapeAppleScriptString(match.id);
		await runOsascript(`
tell application "Ghostty"
	try
		close window id "${escapedId}"
	end try
end tell
`);
	} catch {
		// Already closed
	}
}

/**
 * Return the working directory of the currently selected Ghostty window when
 * Ghostty is frontmost, excluding the sidebar's own window. Used to mark a
 * session's terminal as "focused".
 */
export async function getFocusedTerminalWindow(
	excludeId: string | null,
): Promise<{ workingDirectory: string } | null> {
	if (!(await isTerminalRunning())) return null;
	try {
		const excluded = escapeAppleScriptString(excludeId ?? "");
		const result = await runOsascript(`
set isFront to false
tell application "System Events"
	try
		set isFront to (frontmost of process "ghostty")
	end try
end tell
if isFront is false then return ""
tell application "Ghostty"
	try
		set w to front window
		if (id of w as string) is "${excluded}" then return ""
		return (working directory of (focused terminal of (selected tab of w))) as string
	on error
		return ""
	end try
end tell
`);
		return result.length > 0 ? { workingDirectory: result } : null;
	} catch {
		return null;
	}
}

export interface ManagedTerminal {
	worktreePath: string;
}

/**
 * Reposition all managed Ghostty windows to fill the area right of the sidebar,
 * excluding the sidebar's own window.
 */
export async function repositionAllTerminals(
	managed: ManagedTerminal[],
	excludeId: string | null,
): Promise<void> {
	if (managed.length === 0) return;
	if (!(await isTerminalRunning())) return;
	const sidebar = await getSidebarBounds(excludeId);
	if (!sidebar) return;

	const windows = await listTerminalWindows(excludeId);
	const targets = windows.filter((w) =>
		managed.some((m) => terminalMatchesWorktree(w, m.worktreePath)),
	);
	if (targets.length === 0) return;

	const { x, y, width, height } = await computeLayout(sidebar);
	const namesAppleScript = targets.map((w) => `"${escapeAppleScriptString(w.name)}"`).join(", ");
	try {
		await runOsascript(`
tell application "System Events"
	tell process "ghostty"
		set managedNames to {${namesAppleScript}}
		repeat with w in every window
			set wName to name of w
			set isManaged to false
			repeat with t in managedNames
				if wName is (t as text) then
					set isManaged to true
					exit repeat
				end if
			end repeat
			if isManaged then
				set position of w to {${x}, ${y}}
				set size of w to {${width}, ${height}}
			end if
		end repeat
	end tell
end tell
`);
	} catch {
		// No windows to position
	}
}
