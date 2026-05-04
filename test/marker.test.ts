import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionTitleToken, writeWindowTitleMarker } from "../src/workspace/marker.ts";
import { windowMatchesSession } from "../src/workspace/window.ts";

let workdir: string;

beforeEach(() => {
	workdir = mkdtempSync(join(tmpdir(), "ccdock-marker-"));
});

afterEach(() => {
	rmSync(workdir, { recursive: true, force: true });
});

describe("writeWindowTitleMarker", () => {
	test("creates .vscode/settings.json with window.title token", () => {
		writeWindowTitleMarker(workdir, "abc123");
		const file = join(workdir, ".vscode", "settings.json");
		expect(existsSync(file)).toBe(true);
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
		expect(parsed["window.title"]).toContain(sessionTitleToken("abc123"));
	});

	test("merges into existing settings without clobbering other keys", () => {
		mkdirSync(join(workdir, ".vscode"), { recursive: true });
		const file = join(workdir, ".vscode", "settings.json");
		writeFileSync(file, JSON.stringify({ "editor.fontSize": 14 }));

		writeWindowTitleMarker(workdir, "abc123");
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
		expect(parsed["editor.fontSize"]).toBe(14);
		expect(parsed["window.title"]).toContain(sessionTitleToken("abc123"));
	});

	test("does not overwrite a user-defined window.title", () => {
		mkdirSync(join(workdir, ".vscode"), { recursive: true });
		const file = join(workdir, ".vscode", "settings.json");
		writeFileSync(file, JSON.stringify({ "window.title": "${rootName}" }));

		writeWindowTitleMarker(workdir, "abc123");
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
		expect(parsed["window.title"]).toBe("${rootName}");
	});

	test("re-running on a ccdock-managed file is a no-op (idempotent)", () => {
		writeWindowTitleMarker(workdir, "abc123");
		const file = join(workdir, ".vscode", "settings.json");
		const before = readFileSync(file, "utf-8");
		writeWindowTitleMarker(workdir, "abc123");
		const after = readFileSync(file, "utf-8");
		expect(after).toBe(before);
	});
});

describe("windowMatchesSession", () => {
	test("matches via ccdock token even when basename collides", () => {
		const titleA = "file.ts — repoA — ccdock:abc123";
		const titleB = "file.ts — repoB — ccdock:def456";
		// Two sessions with the same branch basename but different sessionIds.
		expect(windowMatchesSession(titleA, "feature-x", "abc123")).toBe(true);
		expect(windowMatchesSession(titleB, "feature-x", "abc123")).toBe(false);
	});

	test("falls back to basename match when no sessionId is supplied", () => {
		const title = "file.ts — repo — Visual Studio Code";
		expect(windowMatchesSession(title, "repo", null)).toBe(true);
	});
});
