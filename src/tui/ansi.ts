// ANSI escape code utilities for 256-color terminal rendering

export const ESC = "\x1b";
export const CSI = `${ESC}[`;

// Screen control
export const CLEAR_SCREEN = `${CSI}2J`;
export const CURSOR_HOME = `${CSI}H`;
export const CURSOR_HIDE = `${CSI}?25l`;
export const CURSOR_SHOW = `${CSI}?25h`;
// Text attributes
export const RESET = `${CSI}0m`;
export const BOLD = `${CSI}1m`;
export const DIM = `${CSI}2m`;

// Color helpers (256-color)
export function fg256(code: number): string {
	return `${CSI}38;5;${code}m`;
}

export function bg256(code: number): string {
	return `${CSI}48;5;${code}m`;
}

// Theme colors
export const COLORS = {
	running: fg256(82), // bright green
	waiting: fg256(220), // yellow/orange
	idle: fg256(73), // teal
	error: fg256(196), // red
	unknown: fg256(245), // gray

	title: fg256(255), // white
	subtitle: fg256(250), // light gray
	muted: fg256(240), // dark gray
	border: fg256(238), // subtle border
	highlight: fg256(117), // light blue
	accent: fg256(213), // pink/magenta

	bgSelected: bg256(236), // dark highlight
	bgHeader: bg256(235), // header background

	// Editor state colors
	editorFocused: fg256(255), // bright white — focused editor
	editorOpen: fg256(117), // cyan — open but not focused
	editorClosed: fg256(240), // dark gray — closed
	borderFocused: fg256(255), // bright white border — VS Code window focused
	borderSelected: fg256(75), // soft blue border — J/K cursor selection
	borderOpen: fg256(248), // light gray border
	borderClosed: fg256(235), // very dark border
} as const;

// Status colors
export function statusColor(status: string): string {
	switch (status) {
		case "running":
			return COLORS.running;
		case "waiting":
			return COLORS.waiting;
		case "idle":
			return COLORS.idle;
		case "error":
			return COLORS.error;
		default:
			return COLORS.unknown;
	}
}

// Status icons
export function statusIcon(status: string, frame: number): string {
	const pulse = frame % 4 < 2;
	switch (status) {
		case "running":
			return "\u25cf"; // ●
		case "waiting":
			return pulse ? "\u25cf" : "\u25cb";
		case "idle":
			return "\u25cb"; // ○
		case "error":
			return "\u25cf"; // ●
		default:
			return "\u25cb";
	}
}

// Utility functions
export function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes contain control characters
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(str: string): number {
	return stripAnsi(str).length;
}

export function truncate(str: string, maxLen: number): string {
	const visible = stripAnsi(str);
	if (visible.length <= maxLen) return str;

	// ANSI-aware truncation: walk through the string preserving escape sequences
	let visCount = 0;
	let result = "";
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes contain control characters
	const re = /(\x1b\[[0-9;]*m)|(.)/g;
	let m = re.exec(str);
	while (m !== null) {
		if (m[1]) {
			// ANSI escape sequence — always include
			result += m[1];
		} else if (m[2]) {
			if (visCount >= maxLen - 1) {
				result += `${RESET}\u2026`;
				return result;
			}
			result += m[2];
			visCount++;
		}
		m = re.exec(str);
	}
	return result;
}

export function shortenHome(path: string): string {
	const home = process.env.HOME ?? "";
	if (home && path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export function moveCursor(row: number, col: number): string {
	return `${CSI}${row};${col}H`;
}

export function clearLine(): string {
	return `${CSI}2K`;
}

// Box-drawing characters
export const BOX = {
	topLeft: "\u256d",
	topRight: "\u256e",
	bottomLeft: "\u2570",
	bottomRight: "\u256f",
	horizontal: "\u2500",
	vertical: "\u2502",
	teeRight: "\u251c",
	teeLeft: "\u2524",
} as const;
