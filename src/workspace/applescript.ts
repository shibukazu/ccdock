/** Escape a string for safe interpolation into an AppleScript double-quoted literal. */
export function escapeAppleScriptString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
