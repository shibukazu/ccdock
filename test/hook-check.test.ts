import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrokenHookCommands } from "../src/agent/hook-check.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ccdock-hook-check-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeSettings(command: string): string {
	const settingsPath = join(dir, "settings.json");
	writeFileSync(
		settingsPath,
		JSON.stringify({
			hooks: {
				PreToolUse: [{ matcher: "", hooks: [{ type: "command", command }] }],
			},
		}),
	);
	return settingsPath;
}

describe("findBrokenHookCommands", () => {
	test("reports a ccdock command whose absolute path does not exist", () => {
		const missingPath = join(dir, "nonexistent-ccdock");
		const settingsPath = writeSettings(`${missingPath} hook claude-code PreToolUse`);
		expect(findBrokenHookCommands(settingsPath)).toEqual([missingPath]);
	});

	test("does not report a ccdock command whose path exists", () => {
		const existingPath = join(dir, "ccdock-bin");
		writeFileSync(existingPath, "");
		const settingsPath = writeSettings(`${existingPath} hook claude-code PreToolUse`);
		expect(findBrokenHookCommands(settingsPath)).toEqual([]);
	});
});
