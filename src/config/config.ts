import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HubConfig } from "../types.ts";

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

const DEFAULT_CONFIG: HubConfig = {
	workspace_dirs: ["~/workspace"],
	editor: "code",
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
		const parsed = JSON.parse(raw) as HubConfig;
		return resolveConfig(parsed);
	} catch {
		return resolveConfig(DEFAULT_CONFIG);
	}
}

function resolveConfig(config: HubConfig): HubConfig {
	return {
		workspace_dirs: config.workspace_dirs.map(expandTilde).filter((dir) => existsSync(dir)),
		editor: config.editor ?? "code",
	};
}
