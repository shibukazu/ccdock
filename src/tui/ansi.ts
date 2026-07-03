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
	idle: fg256(245), // muted gray — started but no activity yet
	stopped: fg256(73), // teal — completed work (Stop event received)
	error: fg256(196), // red
	unknown: fg256(245), // gray

	title: fg256(255), // white
	subtitle: fg256(250), // light gray
	muted: fg256(240), // dark gray
	border: fg256(238), // subtle border
	highlight: fg256(117), // light blue
	accent: fg256(213), // pink/magenta

	// diff badge accents
	diffAdd: fg256(82), // green — additions
	diffDel: fg256(196), // red — deletions
	diffFile: fg256(220), // yellow — changed files

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
		case "stopped":
			return COLORS.stopped;
		case "error":
			return COLORS.error;
		default:
			return COLORS.unknown;
	}
}

// Status icons — differentiated per state (orca-style).
//   running=● waiting=◐(pulses) idle=○ stopped=✓ error=✗
export function statusIcon(status: string, frame: number): string {
	const pulse = frame % 4 < 2;
	switch (status) {
		case "running":
			return "●"; // ●
		case "waiting":
			return pulse ? "◐" : "○"; // ◐ / ○ — pulsing
		case "idle":
			return "○"; // ○ — not started / no activity
		case "stopped":
			return "✓"; // ✓ — completed
		case "error":
			return "✗"; // ✗
		default:
			return "○";
	}
}

// Status pill badge: state-colored background + black text (orca-style).
// The returned string always has a visible length of 6 (`" RUN  "` etc.) so it
// aligns with padRight/visibleLength-based layout.
const BLACK_FG = fg256(0);
export function statusBadge(status: string): string {
	const label = statusBadgeLabel(status);
	const bg = statusBadgeBg(status);
	return `${bg}${BLACK_FG}${BOLD} ${label} ${RESET}`;
}

function statusBadgeLabel(status: string): string {
	switch (status) {
		case "running":
			return "RUN ";
		case "waiting":
			return "WAIT";
		case "stopped":
			return "DONE";
		case "error":
			return "ERR ";
		case "idle":
			return "IDLE";
		default:
			return "??? ";
	}
}

function statusBadgeBg(status: string): string {
	switch (status) {
		case "running":
			return bg256(82); // bright green
		case "waiting":
			return bg256(220); // yellow
		case "stopped":
			return bg256(73); // teal
		case "error":
			return bg256(196); // red
		case "idle":
			return bg256(245); // gray
		default:
			return bg256(240);
	}
}

// Agent-type glyphs (single-width, non-nerd-font).
export function agentTypeIcon(type: string): string {
	switch (type) {
		case "claude-code":
			return "✦"; // ✦
		case "codex":
			return "◇"; // ◇
		default:
			return "◇";
	}
}

// Human-readable elapsed time: 45s / 3m / 2h / 1d.
export function formatElapsed(ms: number): string {
	const clamped = ms < 0 ? 0 : ms;
	const s = Math.floor(clamped / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h`;
	const d = Math.floor(h / 24);
	return `${d}d`;
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
				result += `${RESET}…`;
				return result;
			}
			result += m[2];
			visCount++;
		}
		m = re.exec(str);
	}
	return result;
}

export function formatMem(mb: number): string {
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb}M`;
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
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	horizontal: "─",
	vertical: "│",
	teeRight: "├",
	teeLeft: "┤",
} as const;
