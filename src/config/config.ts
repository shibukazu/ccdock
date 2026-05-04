import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HubConfig, NotificationsConfig, SoundConfig } from "../types.ts";

const CONFIG_DIR_NAME = "ccdock";

function getConfigDir(): string {
	const home = process.env.HOME ?? "";
	const configBase = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
	return join(configBase, CONFIG_DIR_NAME);
}

function getConfigPath(): string {
	return join(getConfigDir(), "config.json");
}

function expandTilde(p: string): string {
	const home = process.env.HOME ?? "";
	if (p.startsWith("~/")) {
		return join(home, p.slice(2));
	}
	return p;
}

const DEFAULT_SOUND: SoundConfig = {
	enabled: true,
	permission_request: "/System/Library/Sounds/Funk.aiff",
	notification: "/System/Library/Sounds/Glass.aiff",
};

const DEFAULT_NOTIFICATIONS: NotificationsConfig = {
	enabled: true,
	events: ["PermissionRequest", "Notification"],
};

const DEFAULT_CONFIG: HubConfig = {
	workspace_dirs: ["~/workspace"],
	editor: "code",
	sound: DEFAULT_SOUND,
	notifications: DEFAULT_NOTIFICATIONS,
};

export function loadConfig(): HubConfig {
	const configDir = getConfigDir();
	const configPath = getConfigPath();

	// Auto-create config directory and file on first run
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}

	if (!existsSync(configPath)) {
		writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
		return resolveConfig(DEFAULT_CONFIG);
	}

	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<HubConfig>;
		return resolveConfig(parsed);
	} catch {
		return resolveConfig(DEFAULT_CONFIG);
	}
}

function resolveConfig(config: Partial<HubConfig>): HubConfig {
	const sound: SoundConfig = {
		enabled: config.sound?.enabled ?? DEFAULT_SOUND.enabled,
		permission_request:
			config.sound?.permission_request?.trim() || DEFAULT_SOUND.permission_request,
		notification: config.sound?.notification?.trim() || DEFAULT_SOUND.notification,
	};
	const events =
		Array.isArray(config.notifications?.events) && config.notifications.events.length > 0
			? config.notifications.events
			: DEFAULT_NOTIFICATIONS.events;
	const notifications: NotificationsConfig = {
		enabled: config.notifications?.enabled ?? DEFAULT_NOTIFICATIONS.enabled,
		events,
	};
	return {
		workspace_dirs: (config.workspace_dirs ?? DEFAULT_CONFIG.workspace_dirs)
			.map(expandTilde)
			.filter((dir) => existsSync(dir)),
		editor: config.editor ?? "code",
		sound,
		notifications,
	};
}
