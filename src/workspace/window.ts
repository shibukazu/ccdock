/**
 * macOS native window management via AppleScript / System Events.
 *
 * VS Code window identity:
 *   We resolve windows by AXDocument (the URL of the file currently focused
 *   inside the window) when possible — that path lies under the worktree
 *   root, so two sessions sharing the same branch basename across different
 *   repositories do not collide. AXDocument is empty for some VS Code views
 *   (e.g. PR diff tabs, no editor open), so a basename match on the window
 *   title is the fallback.
 */

import { escapeAppleScriptString } from "./applescript.ts";

interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface EditorWindow {
	title: string;
	/** Filesystem path of the focused document in this window, or null if VS Code does not expose one. */
	documentPath: string | null;
}

/**
 * Strict match between a VS Code window title and a worktree basename.
 * VS Code titles look like "<file> — <workspace>" or "<workspace> — Visual Studio Code",
 * where the workspace token is bounded by em dash / slash / whitespace.
 * We require a bounded match so that basename "foo" does not match window "foo-bar".
 */
export function windowMatchesWorktree(windowTitle: string, worktreeBasename: string): boolean {
	if (!worktreeBasename || !windowTitle) return false;
	const esc = worktreeBasename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`(?:^|[\\s\\u2014/])${esc}(?:[\\s\\u2014/]|$)`);
	return re.test(windowTitle);
}

function decodeFileUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	// VS Code typically returns file:///<absolute-path>; older macOS variants
	// can include a host component (file://localhost/...). Strip both.
	let path: string;
	if (trimmed.startsWith("file://")) {
		path = trimmed.slice("file://".length);
		if (path.startsWith("localhost/")) path = path.slice("localhost".length);
	} else if (trimmed.startsWith("/")) {
		path = trimmed; // already a plain absolute path
	} else {
		return null;
	}
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

/**
 * True when the window's focused document lies inside the worktree directory.
 * This is the strong signal — it disambiguates same-named branches across
 * different repository roots without touching the user's repo files.
 */
export function windowMatchesWorktreePath(window: EditorWindow, worktreePath: string): boolean {
	if (!window.documentPath || !worktreePath) return false;
	const root = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;
	return window.documentPath === worktreePath || window.documentPath.startsWith(root);
}

/**
 * Combined match. Two channels:
 *   1. AXDocument path under the worktree root (strongest — disambiguates
 *      same-named branches across different repos).
 *   2. Basename match against the window title (fallback for views that do
 *      not expose AXDocument and for documents outside the worktree).
 *
 * The basename channel can produce a false positive when two repos host
 * branches with the same basename and one of those windows has its focused
 * document outside the worktree; the AXDocument channel handles the common
 * case where the user is editing a file inside the worktree.
 */
export function windowMatches(
	window: EditorWindow,
	worktreePath: string,
	worktreeBasename: string,
): boolean {
	if (windowMatchesWorktreePath(window, worktreePath)) return true;
	return windowMatchesWorktree(window.title, worktreeBasename);
}

async function resolveMatchingWindows(worktreePath: string): Promise<EditorWindow[]> {
	const basename = worktreePath.split("/").pop() ?? "";
	const windows = await listEditorWindows();
	return windows.filter((w) => windowMatches(w, worktreePath, basename));
}

async function runOsascript(script: string): Promise<string> {
	const proc = Bun.spawn(["osascript", "-e", script], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	if (proc.exitCode !== 0 && err.trim() && process.env.CCDOCK_DEBUG) {
		process.stderr.write(`[osascript] ${err.trim()}\n`);
	}
	return out.trim();
}

async function runJXA(script: string): Promise<string> {
	const proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", script], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out.trim();
}

/**
 * Get the bounds of the sidebar terminal window (the frontmost Ghostty window).
 */
export async function getSidebarBounds(): Promise<WindowBounds | null> {
	try {
		const result = await runOsascript(`
tell application "System Events"
	tell process "Ghostty"
		set w to front window
		set p to position of w
		set s to size of w
		return "" & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
	end tell
end tell
`);
		const parts = result.split(",").map((s) => Number.parseInt(s.trim(), 10));
		if (parts.length < 4) return null;
		return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
	} catch {
		return null;
	}
}

/**
 * Get the right edge (x coordinate) of the screen containing the sidebar window.
 * Uses JXA + NSScreen with proper coordinate conversion for multi-monitor setups.
 *
 * Coordinate systems:
 *   NSScreen: origin at bottom-left of primary display, y increases upward.
 *             Screens to the left have negative x.
 *   AppleScript: origin at top-left of primary display, y increases downward.
 *             x=0 is the left edge of the leftmost monitor.
 *
 * Conversions (using primaryH = height of primary NSScreen):
 *   nsX = asX + nsMinX          (nsMinX = min x across all NSScreens)
 *   nsY = primaryH - asCenterY  (Y axis is flipped)
 */
async function getScreenRightEdge(sidebar: WindowBounds): Promise<number> {
	// Fallback: typical MacBook Pro screen width from the sidebar's right edge
	const fallback = 1512;
	try {
		// Use the window center for a more robust screen hit-test
		const asCenterX = sidebar.x + sidebar.width / 2;
		const asCenterY = sidebar.y + sidebar.height / 2;
		const result = await runJXA(`
ObjC.import("AppKit");
var asCenterX = ${asCenterX};
var asCenterY = ${asCenterY};
var screens = $.NSScreen.screens;
var count = screens.count;
var primaryH = $.NSScreen.mainScreen.frame.size.height;
// NSScreen always places the primary display at x=0, same as AppleScript.
// So AS.x == NS.x (no x offset needed).
// Only Y is flipped: nsY = primaryH - asY.
var nsX = asCenterX;
var nsY = primaryH - asCenterY;
// Find screen whose bounds contain the converted center point
var found = false;
var result = 1512;
for (var i = 0; i < count; i++) {
    var s = screens.objectAtIndex(i);
    var left = s.frame.origin.x;
    var bottom = s.frame.origin.y;
    var width = s.frame.size.width;
    var height = s.frame.size.height;
    if (left <= nsX && nsX < left + width && bottom <= nsY && nsY < bottom + height) {
        result = Math.round(left + width);
        found = true;
        break;
    }
}
if (!found) {
    var main = $.NSScreen.mainScreen;
    result = Math.round(main.frame.origin.x + main.frame.size.width);
}
result;
`);
		const value = Number.parseInt(result, 10);
		return Number.isNaN(value) || value <= 0 ? fallback : value;
	} catch {
		return fallback;
	}
}

/**
 * Move and resize a VS Code window to fill the area right of the sidebar.
 */
export async function positionEditorWindow(
	worktreePath: string,
	sidebarBounds: WindowBounds,
): Promise<boolean> {
	const matches = await resolveMatchingWindows(worktreePath);
	const fullTitle = matches[0]?.title;
	if (!fullTitle) return false;

	const editorX = sidebarBounds.x + sidebarBounds.width + 4; // 4px gap
	const editorY = sidebarBounds.y;
	const screenRight = await getScreenRightEdge(sidebarBounds);
	const editorWidth = screenRight - editorX;
	const editorHeight = sidebarBounds.height;

	try {
		const escapedTitle = escapeAppleScriptString(fullTitle);

		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set targetWindow to missing value
		repeat with w in every window
			if name of w is "${escapedTitle}" then
				set targetWindow to w
				exit repeat
			end if
		end repeat
		if targetWindow is not missing value then
			set position of targetWindow to {${editorX}, ${editorY}}
			set size of targetWindow to {${editorWidth}, ${editorHeight}}
		end if
	end tell
end tell
`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a VS Code window for this worktree exists.
 */
export async function editorWindowExists(worktreePath: string): Promise<boolean> {
	const matches = await resolveMatchingWindows(worktreePath);
	return matches.length > 0;
}

/**
 * Bring the VS Code window for this worktree to front and position it next
 * to the sidebar. Returns false if no matching window exists.
 */
export async function focusAndPositionEditor(worktreePath: string): Promise<boolean> {
	const matches = await resolveMatchingWindows(worktreePath);
	const fullTitle = matches[0]?.title;
	if (!fullTitle) return false;

	const sidebar = await getSidebarBounds();
	if (!sidebar) return false;

	try {
		const escapedTitle = escapeAppleScriptString(fullTitle);

		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set frontmost to true
		repeat with w in every window
			if name of w is "${escapedTitle}" then
				perform action "AXRaise" of w
				exit repeat
			end if
		end repeat
	end tell
end tell
`);

		await positionEditorWindow(worktreePath, sidebar);
		return true;
	} catch {
		return false;
	}
}

async function isEditorRunning(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["pgrep", "-x", "Code"], { stdout: "ignore", stderr: "ignore" });
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

const FIELD_SEP = "<<F>>";
const ROW_SEP = "<<R>>";

/**
 * List all VS Code windows along with their AXDocument (focused file URL).
 * AXDocument may be missing for non-editor views; in that case documentPath is null.
 *
 * The AppleScript is split into two passes — titles first, then per-window
 * AXDocument lookups — because mutating `text item delimiters` inside the
 * `tell process` block has been flaky in practice.
 */
export async function listEditorWindows(): Promise<EditorWindow[]> {
	if (!(await isEditorRunning())) return [];
	try {
		// `tell process "Code"` is kept minimal: collect titles/docs into local
		// variables only. Any reference to `end of <list>` inside that block
		// reads as "last insertion point of <UI element>", which AppleScript
		// then tries to assign to and fails (-10006). So we build the result
		// list and join it outside the tell block.
		const result = await runOsascript(`
set winTitles to {}
set winDocs to {}
tell application "System Events"
	tell process "Code"
		set wins to every window
	end tell
	repeat with w in wins
		set t to ""
		set d to ""
		tell process "Code"
			try
				set t to (name of w) as string
			end try
			try
				set rawDoc to value of attribute "AXDocument" of w
				if rawDoc is not missing value then set d to rawDoc as string
			end try
		end tell
		copy t to end of winTitles
		copy d to end of winDocs
	end repeat
end tell
set savedDelim to AppleScript's text item delimiters
set rows to {}
set n to count of winTitles
repeat with i from 1 to n
	set row to (item i of winTitles) & "${FIELD_SEP}" & (item i of winDocs)
	copy row to end of rows
end repeat
set AppleScript's text item delimiters to "${ROW_SEP}"
set joined to rows as text
set AppleScript's text item delimiters to savedDelim
return joined
`);
		if (process.env.CCDOCK_DEBUG) {
			process.stderr.write(`[listEditorWindows] raw=${JSON.stringify(result)}\n`);
		}
		if (!result) return [];
		return result
			.split(ROW_SEP)
			.filter((row) => row.length > 0)
			.map((row) => {
				const [title = "", doc = ""] = row.split(FIELD_SEP);
				return { title, documentPath: doc ? decodeFileUrl(doc) : null };
			});
	} catch (err) {
		if (process.env.CCDOCK_DEBUG) {
			process.stderr.write(`[listEditorWindows] error=${String(err)}\n`);
		}
		return [];
	}
}

/**
 * Return the focused VS Code window and whether VS Code is the frontmost app.
 */
export async function getFocusedEditorWindow(): Promise<{
	frontWindow: EditorWindow;
	isFrontmost: boolean;
}> {
	const empty: EditorWindow = { title: "", documentPath: null };
	if (!(await isEditorRunning())) return { frontWindow: empty, isFrontmost: false };
	try {
		const result = await runOsascript(`
set wDoc to ""
set wName to ""
set isFront to false
tell application "System Events"
	tell process "Code"
		set isFront to frontmost
		try
			set wName to (name of front window) as string
		end try
		try
			set rawDoc to value of attribute "AXDocument" of front window
			if rawDoc is not missing value then set wDoc to rawDoc as string
		end try
	end tell
end tell
return (isFront as text) & "${FIELD_SEP}" & wName & "${FIELD_SEP}" & wDoc
`);
		const [isFrontStr, windowName = "", doc = ""] = result.split(FIELD_SEP);
		return {
			frontWindow: {
				title: windowName,
				documentPath: doc ? decodeFileUrl(doc) : null,
			},
			isFrontmost: isFrontStr === "true",
		};
	} catch {
		return { frontWindow: empty, isFrontmost: false };
	}
}

export async function focusSidebar(): Promise<void> {
	try {
		await runOsascript(`
tell application "Ghostty" to activate
`);
	} catch {
		// Ghostty not available
	}
}

/**
 * Close the VS Code window for this worktree.
 * Raises the window then sends Cmd+Shift+W to close it.
 */
export async function closeEditorWindow(worktreePath: string): Promise<void> {
	if (!(await isEditorRunning())) return;
	const matches = await resolveMatchingWindows(worktreePath);
	const fullTitle = matches[0]?.title;
	if (!fullTitle) return;
	try {
		const escapedTitle = escapeAppleScriptString(fullTitle);
		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set frontmost to true
		repeat with w in every window
			if name of w is "${escapedTitle}" then
				perform action "AXRaise" of w
				delay 0.2
				keystroke "w" using {command down, shift down}
				exit repeat
			end if
		end repeat
	end tell
end tell
`);
	} catch {
		// Window not found or already closed
	}
}

/**
 * Close all VS Code windows (without quitting the app).
 */
export async function closeAllEditors(): Promise<void> {
	if (!(await isEditorRunning())) return;
	try {
		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set frontmost to true
		repeat while (count of windows) > 0
			keystroke "w" using {command down, shift down}
			delay 0.3
		end repeat
	end tell
end tell
`);
	} catch {
		// VS Code not running
	}
}

/**
 * Reposition managed VS Code windows to fill the area right of the sidebar.
 * Matching prefers AXDocument (full path) over the worktree basename, so two
 * sessions with the same basename across different repos do not collide.
 */
export interface ManagedWindow {
	worktreePath: string;
}

export async function repositionAllEditors(managed: ManagedWindow[]): Promise<void> {
	const debug = !!process.env.CCDOCK_DEBUG;
	if (debug) {
		process.stderr.write(
			`[reposition] managed=${JSON.stringify(managed.map((m) => m.worktreePath))}\n`,
		);
	}
	if (managed.length === 0) {
		if (debug) process.stderr.write("[reposition] abort: no managed sessions\n");
		return;
	}
	const [running, sidebar] = await Promise.all([isEditorRunning(), getSidebarBounds()]);
	if (debug) {
		process.stderr.write(
			`[reposition] vscode_running=${running} sidebar=${JSON.stringify(sidebar)}\n`,
		);
	}
	if (!running || !sidebar) return;

	const allWindows = await listEditorWindows();
	if (debug) {
		process.stderr.write(`[reposition] windows=${JSON.stringify(allWindows)}\n`);
	}
	const matchedTitles = new Set<string>();
	for (const w of allWindows) {
		for (const m of managed) {
			const basename = m.worktreePath.split("/").pop() ?? "";
			if (windowMatches(w, m.worktreePath, basename)) {
				matchedTitles.add(w.title);
				break;
			}
		}
	}
	if (debug) {
		process.stderr.write(`[reposition] matched=${JSON.stringify(Array.from(matchedTitles))}\n`);
	}
	if (matchedTitles.size === 0) return;

	try {
		const editorX = sidebar.x + sidebar.width + 4;
		const editorY = sidebar.y;
		const screenRight = await getScreenRightEdge(sidebar);
		const editorWidth = screenRight - editorX;
		const editorHeight = sidebar.height;

		const titlesAppleScript = Array.from(matchedTitles)
			.map((t) => `"${escapeAppleScriptString(t)}"`)
			.join(", ");

		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set managedTitles to {${titlesAppleScript}}
		repeat with w in every window
			set wName to name of w
			set isManaged to false
			repeat with t in managedTitles
				if wName is (t as text) then
					set isManaged to true
					exit repeat
				end if
			end repeat
			if isManaged then
				set position of w to {${editorX}, ${editorY}}
				set size of w to {${editorWidth}, ${editorHeight}}
			end if
		end repeat
	end tell
end tell
`);
	} catch {
		// VS Code not running or no windows
	}
}
