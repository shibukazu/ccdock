import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let configRoot: string;
let originalXdg: string | undefined;

beforeEach(() => {
	configRoot = mkdtempSync(join(tmpdir(), "ccdock-config-"));
	originalXdg = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = configRoot;
});

afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = originalXdg;
	rmSync(configRoot, { recursive: true, force: true });
});

function configPath(): string {
	return join(configRoot, "ccdock", "config.json");
}

function writeConfig(content: unknown): void {
	mkdirSync(join(configRoot, "ccdock"), { recursive: true });
	writeFileSync(configPath(), JSON.stringify(content));
}

describe("loadConfig sound section", () => {
	test("auto-creates default config with sound section enabled", async () => {
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.sound.enabled).toBe(true);
		expect(cfg.sound.permission_request).toContain(".aiff");
		expect(cfg.sound.notification).toContain(".aiff");

		// File written to disk reflects the same defaults
		const onDisk = JSON.parse(readFileSync(configPath(), "utf-8"));
		expect(onDisk.sound.enabled).toBe(true);
	});

	test("respects sound.enabled=false", async () => {
		writeConfig({
			workspace_dirs: [],
			editor: "code",
			sound: { enabled: false, permission_request: "", notification: "" },
		});
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.sound.enabled).toBe(false);
	});

	test("falls back to defaults when sound section is missing", async () => {
		writeConfig({ workspace_dirs: [], editor: "code" });
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.sound.enabled).toBe(true);
		expect(cfg.sound.permission_request.length).toBeGreaterThan(0);
		expect(cfg.sound.notification.length).toBeGreaterThan(0);
	});

	test("custom sound paths are preserved", async () => {
		writeConfig({
			workspace_dirs: [],
			editor: "code",
			sound: {
				enabled: true,
				permission_request: "/tmp/perm.aiff",
				notification: "/tmp/note.aiff",
			},
		});
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.sound.permission_request).toBe("/tmp/perm.aiff");
		expect(cfg.sound.notification).toBe("/tmp/note.aiff");
	});

	test("blank sound paths fall back to defaults", async () => {
		writeConfig({
			workspace_dirs: [],
			editor: "code",
			sound: { enabled: true, permission_request: "  ", notification: "" },
		});
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.sound.permission_request.length).toBeGreaterThan(0);
		expect(cfg.sound.notification.length).toBeGreaterThan(0);
	});
});

describe("loadConfig notifications section", () => {
	test("defaults to enabled with Permission/Notification events", async () => {
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.notifications.enabled).toBe(true);
		expect(cfg.notifications.events).toContain("PermissionRequest");
		expect(cfg.notifications.events).toContain("Notification");
	});

	test("respects user-specified events list", async () => {
		writeConfig({
			workspace_dirs: [],
			editor: "code",
			notifications: { enabled: true, events: ["Stop"] },
		});
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.notifications.events).toEqual(["Stop"]);
	});

	test("empty events list falls back to defaults", async () => {
		writeConfig({
			workspace_dirs: [],
			editor: "code",
			notifications: { enabled: true, events: [] },
		});
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.notifications.events.length).toBeGreaterThan(0);
	});

	test("respects notifications.enabled=false", async () => {
		writeConfig({
			workspace_dirs: [],
			editor: "code",
			notifications: { enabled: false, events: ["PermissionRequest"] },
		});
		const { loadConfig } = await import(`../src/config/config.ts?t=${Date.now()}`);
		const cfg = loadConfig();
		expect(cfg.notifications.enabled).toBe(false);
	});
});
