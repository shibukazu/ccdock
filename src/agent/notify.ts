/**
 * macOS Notification Center popup.
 *
 * Two backends, in order of preference:
 *  1. `terminal-notifier` (Homebrew) — supports `-activate <bundleId>` so the
 *     "Show" button focuses Ghostty instead of Script Editor. The bundle id
 *     comes from `CCDOCK_NOTIFY_BUNDLE_ID` (default: com.mitchellh.ghostty).
 *  2. `osascript display notification` — works out of the box but the
 *     "Show" button always opens Script Editor (macOS attributes the
 *     notification to whichever app ran osascript).
 */

import { existsSync } from "node:fs";
import { escapeAppleScriptString } from "../workspace/applescript.ts";

const DEFAULT_ACTIVATE_BUNDLE_ID = "com.mitchellh.ghostty";
const NOTIFICATION_GROUP = "ccdock";
const TERMINAL_NOTIFIER_PATHS = [
	"/opt/homebrew/bin/terminal-notifier",
	"/usr/local/bin/terminal-notifier",
];
const SYSTEM_SOUND_RE = /\/System\/Library\/Sounds\/([^/]+)\.aiff$/;

export interface NotifyOptions {
	title: string;
	message: string;
	subtitle?: string;
	/** Bare sound name e.g. "Glass" — macOS plays it as the alert sound. */
	sound?: string;
}

function findTerminalNotifier(): string | null {
	const explicit = process.env.CCDOCK_TERMINAL_NOTIFIER;
	if (explicit) return existsSync(explicit) ? explicit : null;
	for (const p of TERMINAL_NOTIFIER_PATHS) {
		if (existsSync(p)) return p;
	}
	return null;
}

function postViaTerminalNotifier(bin: string, opts: NotifyOptions): boolean {
	const args = [
		bin,
		"-title",
		opts.title,
		"-message",
		opts.message,
		"-activate",
		process.env.CCDOCK_NOTIFY_BUNDLE_ID ?? DEFAULT_ACTIVATE_BUNDLE_ID,
		"-group",
		NOTIFICATION_GROUP,
	];
	if (opts.subtitle) args.push("-subtitle", opts.subtitle);
	if (opts.sound) args.push("-sound", opts.sound);

	try {
		Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function postViaOsascript(opts: NotifyOptions): void {
	const title = escapeAppleScriptString(opts.title);
	const message = escapeAppleScriptString(opts.message);
	const subtitleClause = opts.subtitle
		? ` subtitle "${escapeAppleScriptString(opts.subtitle)}"`
		: "";
	const soundClause = opts.sound ? ` sound name "${escapeAppleScriptString(opts.sound)}"` : "";

	const script = `display notification "${message}" with title "${title}"${subtitleClause}${soundClause}`;
	try {
		Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" });
	} catch {
		// osascript missing — silently ignore.
	}
}

export function postMacNotification(opts: NotifyOptions): void {
	if (process.env.CCDOCK_SILENT === "1") return;
	if (process.platform !== "darwin") return;

	const bin = findTerminalNotifier();
	if (bin && postViaTerminalNotifier(bin, opts)) return;
	postViaOsascript(opts);
}

/**
 * Convert a config `sound.*` file path like
 * "/System/Library/Sounds/Glass.aiff" into the bare name "Glass" that
 * `display notification` expects. Returns undefined if the path doesn't
 * resolve to a known system sound.
 */
export function soundNameFromPath(path: string | undefined): string | undefined {
	const match = path?.match(SYSTEM_SOUND_RE);
	return match?.[1];
}
