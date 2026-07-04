import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldNotifyForNotification, tryAcquireNotifyLock } from "../src/agent/notify-lock.ts";

let agentsDir: string;

beforeEach(() => {
	agentsDir = mkdtempSync(join(tmpdir(), "ccdock-notify-lock-"));
});

afterEach(() => {
	rmSync(agentsDir, { recursive: true, force: true });
});

describe("tryAcquireNotifyLock", () => {
	test("first acquisition succeeds", () => {
		const now = Date.now();
		expect(tryAcquireNotifyLock(agentsDir, "sess.json", now)).toBe(true);
	});

	test("second acquisition within debounce window is suppressed", () => {
		const now = Date.now();
		expect(tryAcquireNotifyLock(agentsDir, "sess.json", now)).toBe(true);
		expect(tryAcquireNotifyLock(agentsDir, "sess.json", now + 500)).toBe(false);
	});

	test("acquisition after debounce window succeeds again", () => {
		const now = Date.now();
		expect(tryAcquireNotifyLock(agentsDir, "sess.json", now)).toBe(true);
		expect(tryAcquireNotifyLock(agentsDir, "sess.json", now + 4000)).toBe(true);
	});
});

describe("shouldNotifyForNotification", () => {
	test("notification_type permission_prompt is notifiable", () => {
		expect(shouldNotifyForNotification({ notification_type: "permission_prompt" })).toBe(true);
	});

	test("notification_type agent_completed is not notifiable", () => {
		expect(shouldNotifyForNotification({ notification_type: "agent_completed" })).toBe(false);
	});

	test("falls back to message content when notification_type is absent", () => {
		expect(shouldNotifyForNotification({ message: "You have a permission request" })).toBe(true);
	});

	test("defaults to true when no signal is available", () => {
		expect(shouldNotifyForNotification({})).toBe(true);
	});
});
