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

async function runOsascript(script: string): Promise<string> {
	const proc = Bun.spawn(["osascript", "-e", script], {
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
 * Get the screen bounds that the sidebar is on.
 * Returns the full screen dimensions for the monitor containing the sidebar.
 */
export async function getScreenBounds(): Promise<WindowBounds | null> {
	try {
		const result = await runOsascript(`
tell application "Finder"
	set db to bounds of window of desktop
	return "" & (item 1 of db) & "," & (item 2 of db) & "," & (item 3 of db) & "," & (item 4 of db)
end tell
`);
		const parts = result.split(",").map((s) => Number.parseInt(s.trim(), 10));
		if (parts.length < 4) return null;
		return {
			x: parts[0]!,
			y: parts[1]!,
			width: parts[2]! - parts[0]!,
			height: parts[3]! - parts[1]!,
		};
	} catch {
		return null;
	}
}

/**
 * Move and resize a VS Code window to fill the area right of the sidebar.
 * The VS Code window is brought to the current space and positioned
 * adjacent to the sidebar terminal.
 */
export async function positionEditorWindow(
	windowTitle: string,
	sidebarBounds: WindowBounds,
): Promise<boolean> {
	// Calculate editor position: right of sidebar, same height
	const editorX = sidebarBounds.x + sidebarBounds.width + 4; // 4px gap
	const editorY = sidebarBounds.y;
	// Editor width: fill remaining screen width (estimate with a large number)
	// We'll get the actual screen width for precision
	const screen = await getScreenBounds();
	const screenRight = screen ? screen.x + screen.width : 5120; // fallback
	const editorWidth = screenRight - editorX;
	const editorHeight = sidebarBounds.height;

	try {
		// Escape single quotes in title for AppleScript
		const escapedTitle = windowTitle.replace(/'/g, "'\"'\"'");

		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set targetWindow to missing value
		repeat with w in every window
			if name of w contains "${escapedTitle}" then
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
 * Check if a VS Code window with the given title exists.
 */
export async function editorWindowExists(windowTitle: string): Promise<boolean> {
	const windows = await listEditorWindows();
	return windows.some((w) => w.includes(windowTitle));
}

/**
 * Bring a VS Code window to front and position it next to the sidebar.
 * Returns false if the window doesn't exist.
 */
export async function focusAndPositionEditor(windowTitle: string): Promise<boolean> {
	// First check if the window actually exists
	if (!(await editorWindowExists(windowTitle))) {
		return false;
	}

	const sidebar = await getSidebarBounds();
	if (!sidebar) return false;

	try {
		const escapedTitle = windowTitle.replace(/'/g, "'\"'\"'");

		// Activate VS Code and raise the specific window
		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set frontmost to true
		repeat with w in every window
			if name of w contains "${escapedTitle}" then
				perform action "AXRaise" of w
				exit repeat
			end if
		end repeat
	end tell
end tell
`);

		// Position it next to sidebar
		await positionEditorWindow(windowTitle, sidebar);
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
 * Close a specific VS Code window by title match.
 * Raises the window then sends Cmd+W to close it.
 */
export async function closeEditorWindow(windowTitle: string): Promise<void> {
	if (!(await isEditorRunning())) return;
	try {
		const escapedTitle = windowTitle.replace(/'/g, "'\"'\"'");
		await runOsascript(`
tell application "System Events"
	tell process "Code"
		set frontmost to true
		repeat with w in every window
			if name of w contains "${escapedTitle}" then
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
 * Reposition ALL VS Code windows to fill the area right of the sidebar.
 * Called when the sidebar terminal is resized.
 */
export async function repositionAllEditors(): Promise<void> {
	if (!(await isEditorRunning())) return;
	const [sidebar, screen] = await Promise.all([getSidebarBounds(), getScreenBounds()]);
	if (!sidebar) return;

	try {
		const editorX = sidebar.x + sidebar.width + 4;
		const editorY = sidebar.y;
		const screenRight = screen ? screen.x + screen.width : 5120;
		const editorWidth = screenRight - editorX;
		const editorHeight = sidebar.height;

		await runOsascript(`
tell application "System Events"
	tell process "Code"
		repeat with w in every window
			set position of w to {${editorX}, ${editorY}}
			set size of w to {${editorWidth}, ${editorHeight}}
		end repeat
	end tell
end tell
`);
	} catch {
		// VS Code not running or no windows
	}
}
