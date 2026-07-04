import { closeSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const NOTIFY_DEBOUNCE_MS = 3000;

/**
 * Returns true when the caller should emit a notification/sound, false when
 * a recent notification for this agent already claimed the lock.
 *
 * Uses an exclusive lock file (O_EXCL) so the check-and-emit decision is
 * atomic at the OS level across concurrent hook processes — e.g. Claude Code
 * firing Notification and Stop back-to-back would otherwise both pass a
 * plain timestamp comparison.
 */
export function tryAcquireNotifyLock(
	agentsDir: string,
	filename: string,
	now: number,
	debounceMs: number = NOTIFY_DEBOUNCE_MS,
): boolean {
	const lockPath = join(agentsDir, `${filename}.notify.lock`);
	try {
		mkdirSync(agentsDir, { recursive: true });
	} catch {
		// Best-effort — the directory is expected to already exist.
	}

	try {
		const fd = openSync(lockPath, "wx");
		closeSync(fd);
		return true;
	} catch {
		// Lock already exists — fall through to the staleness check.
	}

	try {
		const { mtimeMs } = statSync(lockPath);
		if (now - mtimeMs < debounceMs) return false;

		unlinkSync(lockPath);
		const fd = openSync(lockPath, "wx");
		closeSync(fd);
		return true;
	} catch {
		// Either stat failed, or another process re-created the lock first.
		return false;
	}
}

/**
 * Decides whether a Notification event should pop a user-facing alert.
 *
 * `payload.notification_type` is authoritative when present: only
 * permission/idle/input-style prompts qualify. Falls back to sniffing
 * `payload.message` for the same intent. When neither field gives a signal,
 * defaults to true to avoid silently dropping notifications.
 */
export function shouldNotifyForNotification(payload: Record<string, unknown>): boolean {
	const notificationType = payload.notification_type;
	if (typeof notificationType === "string") {
		const type = notificationType.toLowerCase();
		return (
			type.includes("permission") ||
			type.includes("idle") ||
			type.includes("input") ||
			type.includes("needs")
		);
	}

	const message = payload.message;
	if (typeof message === "string") {
		const text = message.toLowerCase();
		if (text.includes("permission")) return true;
		if (text.includes("waiting for your input")) return true;
	}

	return true;
}
