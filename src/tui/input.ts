export type KeyAction =
	| { type: "up" }
	| { type: "down" }
	| { type: "enter" }
	| { type: "tab" }
	| { type: "quit" }
	| { type: "new" }
	| { type: "delete" }
	| { type: "compact" }
	| { type: "log" }
	| { type: "realign" }
	| { type: "window_close" }
	| { type: "mouse_click"; row: number; col: number }
	| { type: "unknown" };

export type WizardKeyAction =
	| { type: "up" }
	| { type: "down" }
	| { type: "enter" }
	| { type: "escape" }
	| { type: "backspace" }
	| { type: "char"; char: string }
	| { type: "unknown" };

/**
 * Normalize fullwidth ASCII letters / digits / symbols (U+FF01–U+FF5E)
 * to halfwidth so that keyboard shortcuts still fire while a Japanese IME
 * is active. Also maps the fullwidth space (U+3000) to a regular space.
 * Non-ASCII runes outside this range are passed through unchanged.
 */
export function normalizeFullwidth(s: string): string {
	let out = "";
	for (const ch of s) {
		const code = ch.charCodeAt(0);
		if (code >= 0xff01 && code <= 0xff5e) {
			out += String.fromCharCode(code - 0xfee0);
		} else if (code === 0x3000) {
			out += " ";
		} else {
			out += ch;
		}
	}
	return out;
}

export function parseKey(data: Buffer): KeyAction {
	// SGR mouse: \x1b[<button;col;rowM (press) or \x1b[<button;col;rowm (release)
	const raw = data.toString();
	const s = normalizeFullwidth(raw);
	const sgrMatch = s.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
	if (sgrMatch) {
		const button = Number.parseInt(sgrMatch[1]!, 10);
		const col = Number.parseInt(sgrMatch[2]!, 10);
		const row = Number.parseInt(sgrMatch[3]!, 10);
		const isPress = sgrMatch[4] === "M";
		// button 0 = left click press
		if (isPress && button === 0) {
			return { type: "mouse_click", row, col };
		}
		// Scroll up/down
		if (isPress && button === 64) return { type: "up" };
		if (isPress && button === 65) return { type: "down" };
		return { type: "unknown" };
	}

	// Escape sequences for arrow keys
	if (s === "\x1b[A" || s === "k") return { type: "up" };
	if (s === "\x1b[B" || s === "j") return { type: "down" };

	// Enter
	if (s === "\r" || s === "\n") return { type: "enter" };

	// Tab
	if (s === "\t") return { type: "tab" };

	// Quit: q or Ctrl+C
	if (s === "q" || s === "\x03") return { type: "quit" };

	// New session: n
	if (s === "n") return { type: "new" };

	// Delete: d or x
	if (s === "d" || s === "x") return { type: "delete" };

	// Compact mode: c
	if (s === "c") return { type: "compact" };

	// Activity log: l
	if (s === "l") return { type: "log" };

	// Realign VS Code windows: r
	if (s === "r") return { type: "realign" };

	// Close VS Code window for the selected session (keep session/worktree): w
	if (s === "w") return { type: "window_close" };

	return { type: "unknown" };
}

export function parseKeyWizard(data: Buffer): WizardKeyAction {
	const raw = data.toString();
	const s = normalizeFullwidth(raw);

	// Escape sequences for arrow keys
	if (s === "\x1b[A") return { type: "up" };
	if (s === "\x1b[B") return { type: "down" };

	// Enter
	if (s === "\r" || s === "\n") return { type: "enter" };

	// Escape or Ctrl+C
	if (s === "\x1b" || s === "\x03") return { type: "escape" };

	// Backspace
	if (s === "\x7f" || s === "\x08") return { type: "backspace" };

	// Printable characters
	if (s.length === 1 && s.charCodeAt(0) >= 32 && s.charCodeAt(0) <= 126) {
		return { type: "char", char: s };
	}

	return { type: "unknown" };
}

// SGR extended mouse mode: supports coordinates > 223
const MOUSE_ENABLE = "\x1b[?1000h\x1b[?1006h";
const MOUSE_DISABLE = "\x1b[?1000l\x1b[?1006l";

export function enableRawMode(): void {
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdout.write(MOUSE_ENABLE);
	}
}

export function disableRawMode(): void {
	if (process.stdin.isTTY) {
		process.stdout.write(MOUSE_DISABLE);
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
}
