/**
 * macOS native window management via AppleScript/osascript.
 * macOS native window management via AppleScript/System Events.
 */

interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
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

async function resolveWindowTitles(worktreeBasename: string): Promise<string[]> {
	const titles = await listEditorWindows();
	return titles.filter((t) => windowMatchesWorktree(t, worktreeBasename));
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

function escapeAppleScriptString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Move and resize a VS Code window to fill the area right of the sidebar.
 * The VS Code window is brought to the current space and positioned
 * adjacent to the sidebar terminal.
 *
 * `worktreeBasename` is used to resolve a full window title via strict matching.
 */
export async function positionEditorWindow(
	worktreeBasename: string,
	sidebarBounds: WindowBounds,
): Promise<boolean> {
	const matches = await resolveWindowTitles(worktreeBasename);
	const fullTitle = matches[0];
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
 * Check if a VS Code window matching the worktree basename exists.
 */
export async function editorWindowExists(worktreeBasename: string): Promise<boolean> {
	const matches = await resolveWindowTitles(worktreeBasename);
	return matches.length > 0;
}

/**
 * Bring a VS Code window to front and position it next to the sidebar.
 * Returns false if no matching window exists.
 */
export async function focusAndPositionEditor(worktreeBasename: string): Promise<boolean> {
	const matches = await resolveWindowTitles(worktreeBasename);
	const fullTitle = matches[0];
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

		await positionEditorWindow(worktreeBasename, sidebar);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if VS Code process is running.
 */
async function isEditorRunning(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["pgrep", "-x", "Code"], { stdout: "ignore", stderr: "ignore" });
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * List all VS Code window titles.
 */
export async function listEditorWindows(): Promise<string[]> {
	if (!(await isEditorRunning())) return [];
	try {
		const result = await runOsascript(`
tell application "System Events"
	tell process "Code"
		set titles to {}
		repeat with w in every window
			set end of titles to name of w
		end repeat
		set AppleScript's text item delimiters to "|||"
		return titles as text
	end tell
end tell
`);
		if (!result) return [];
		return result.split("|||").filter((t) => t.length > 0);
	} catch {
		return [];
	}
}

/**
 * Get the focused (front) VS Code window title, and whether VS Code is frontmost app.
 */
export async function getFocusedEditorWindow(): Promise<{
	frontWindow: string;
	isFrontmost: boolean;
}> {
	if (!(await isEditorRunning())) return { frontWindow: "", isFrontmost: false };
	try {
		const result = await runOsascript(`
tell application "System Events"
	tell process "Code"
		set isFront to frontmost
		set wName to name of front window
		return (isFront as text) & "|||" & wName
	end tell
end tell
`);
		const [isFrontStr, windowName] = result.split("|||");
		return {
			frontWindow: windowName ?? "",
			isFrontmost: isFrontStr === "true",
		};
	} catch {
		return { frontWindow: "", isFrontmost: false };
	}
}

/**
 * Focus the sidebar terminal (bring Ghostty to front).
 */
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
 * Close a specific VS Code window matching the worktree basename.
 * Raises the window then sends Cmd+Shift+W to close it.
 */
export async function closeEditorWindow(worktreeBasename: string): Promise<void> {
	if (!(await isEditorRunning())) return;
	const matches = await resolveWindowTitles(worktreeBasename);
	const fullTitle = matches[0];
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
		// Close each window one by one with Cmd+Shift+W (close window, not tab)
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
 * Matching uses strict bounded matching (see windowMatchesWorktree) on the full
 * list of window titles, and only matched windows are repositioned.
 */
export async function repositionAllEditors(managedBasenames: string[]): Promise<void> {
	if (managedBasenames.length === 0) return;
	const [running, sidebar] = await Promise.all([isEditorRunning(), getSidebarBounds()]);
	if (!running || !sidebar) return;

	// Resolve basenames -> full window titles via JS-side strict matching
	const allTitles = await listEditorWindows();
	const matchedTitles = new Set<string>();
	for (const title of allTitles) {
		for (const basename of managedBasenames) {
			if (windowMatchesWorktree(title, basename)) {
				matchedTitles.add(title);
				break;
			}
		}
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
