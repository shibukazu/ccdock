import { loadConfig } from "../config/config.ts";
import type { AgentState, AgentType, HubConfig } from "../types.ts";
import {
	findSessionByPath,
	readAgentState,
	removeAgentFile,
	writeAgentState,
} from "../workspace/state.ts";
import { postMacNotification, soundNameFromPath } from "./notify.ts";

function sanitize(path: string): string {
	return path.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

function extractToolDetail(
	agentType: AgentType,
	toolName: string,
	toolInput: Record<string, unknown>,
): string {
	if (agentType === "codex") {
		return extractCodexToolDetail(toolName, toolInput);
	}
	return extractClaudeCodeToolDetail(toolName, toolInput);
}

function extractClaudeCodeToolDetail(toolName: string, toolInput: Record<string, unknown>): string {
	switch (toolName) {
		case "Bash":
			return (toolInput.command as string) ?? "";
		case "Read":
		case "Write":
			return shortenPath((toolInput.file_path as string) ?? "");
		case "Edit":
			return shortenPath((toolInput.file_path as string) ?? "");
		case "Grep":
			return `/${(toolInput.pattern as string) ?? ""}/`;
		case "Glob":
			return (toolInput.pattern as string) ?? "";
		case "Agent":
		case "Task":
			return (toolInput.description as string) ?? (toolInput.prompt as string)?.slice(0, 80) ?? "";
		case "WebSearch":
			return (toolInput.query as string) ?? "";
		case "WebFetch":
			return (toolInput.url as string) ?? "";
		default:
			return "";
	}
}

function extractCodexToolDetail(toolName: string, toolInput: Record<string, unknown>): string {
	switch (toolName) {
		case "local_shell":
		case "shell":
		case "shell_command":
		case "exec_command": {
			const command = toolInput.command;
			if (Array.isArray(command)) return command.join(" ");
			if (typeof command === "string") return command;
			return "";
		}
		case "apply_patch": {
			const path = (toolInput.file_path as string) ?? (toolInput.path as string) ?? "";
			return shortenPath(path);
		}
		default:
			return "";
	}
}

function shortenPath(path: string): string {
	const home = process.env.HOME ?? "";
	if (home && path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

function buildPrompt(eventName: string, payload: Record<string, unknown>): string {
	if (eventName === "PreToolUse" || eventName === "PostToolUse") {
		const toolName = (payload.tool_name as string) ?? "";
		return `[${eventName}] ${toolName}`;
	}
	if (eventName === "Stop") {
		const reason = (payload.stop_reason as string) ?? "completed";
		return `[Stop] ${reason}`;
	}
	return `[${eventName}]`;
}

const STATUS_MAP: Record<string, string> = {
	PreToolUse: "running",
	PostToolUse: "running",
	SubagentToolUse: "running",
	PermissionRequest: "waiting",
	Stop: "stopped",
	SessionEnd: "remove",
};

const ATTENTION_EVENTS = new Set(["PermissionRequest", "Notification"]);

function pickSoundFile(eventName: string, sound: HubConfig["sound"]): string {
	if (eventName === "PermissionRequest") return sound.permission_request;
	return sound.notification;
}

/**
 * Macos Notification Center plays its own sound, so when we post one we
 * suppress the standalone afplay path to avoid a double-beep.
 */
function reactToEvent(eventName: string, payload: Record<string, unknown>): void {
	if (process.env.CCDOCK_SILENT === "1") return;
	if (process.platform !== "darwin") return;

	const config = loadConfig();
	const soundFile = pickSoundFile(eventName, config.sound);
	const wantNotification =
		config.notifications.enabled && config.notifications.events.includes(eventName);

	if (wantNotification) {
		const cwd = (payload.cwd as string) ?? "";
		const toolName = (payload.tool_name as string) ?? "";
		const message = (payload.message as string) ?? toolName ?? eventName;
		postMacNotification({
			title: `ccdock — ${eventName}`,
			subtitle: cwd ? (cwd.split("/").pop() ?? "") : "",
			message: message || eventName,
			sound: config.sound.enabled ? soundNameFromPath(soundFile) : undefined,
		});
		return;
	}

	if (!ATTENTION_EVENTS.has(eventName)) return;
	if (!config.sound.enabled || !soundFile) return;
	try {
		Bun.spawn(["afplay", soundFile], { stdout: "ignore", stderr: "ignore" });
	} catch {
		// afplay missing — ignore.
	}
}

export async function handleHook(agentType: string, eventName: string): Promise<void> {
	let payload: Record<string, unknown> = {};
	try {
		const input = await Bun.stdin.text();
		if (input.trim()) {
			payload = JSON.parse(input) as Record<string, unknown>;
		}
	} catch {
		// No stdin or invalid JSON - continue with empty payload
	}

	const cwd = (payload.cwd as string) ?? process.cwd();
	const claudeSessionId = payload.session_id as string | undefined;

	if (!claudeSessionId) {
		return;
	}

	// Subagents (Task tool) inherit a fresh session_id but are already represented
	// by the parent's Task tool entry — writing a separate agent file would
	// duplicate them as independent agents on the sidebar. Detect via
	// parent_tool_use_id, which Claude Code sets only on subagent invocations.
	if (payload.parent_tool_use_id) {
		return;
	}

	const filename = `${sanitize(cwd)}-${claudeSessionId}.json`;

	const mappedStatus = STATUS_MAP[eventName];

	if (mappedStatus === "remove") {
		removeAgentFile(filename);
		return;
	}

	// Audible / visual cue.
	// Sounds always fire on PermissionRequest / Notification (legacy default);
	// Mac notifications fire on whatever events the config subscribes to.
	reactToEvent(eventName, payload);

	// Notification doesn't carry meaningful status info — preserve previous state
	if (eventName === "Notification") {
		const prev = readAgentState(filename);
		if (prev) {
			prev.updatedAt = Date.now();
			writeAgentState(prev, filename);
		}
		return;
	}

	const status = mappedStatus ?? "unknown";
	const sessionId = findSessionByPath(cwd);
	const rawToolName = (payload.tool_name as string) ?? "";
	const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};
	const rawToolDetail = extractToolDetail(agentType as AgentType, rawToolName, toolInput);

	// Preserve previous toolName/toolDetail only for events that don't carry tool info
	// but clear them on Stop (stopped) since the agent is no longer doing anything
	let toolName = rawToolName;
	let toolDetail = rawToolDetail;
	if (!toolName && status !== "stopped") {
		const prev = readAgentState(filename);
		if (prev) {
			toolName = prev.toolName ?? "";
			toolDetail = prev.toolDetail ?? "";
		}
	}

	// Hook is spawned by the agent process, so process.ppid points at the agent.
	// Sidebar uses this to sample CPU / memory via `ps`.
	const state: AgentState = {
		sessionId,
		agentType: agentType as AgentType,
		status: status as AgentState["status"],
		prompt: buildPrompt(eventName, payload),
		toolName,
		toolDetail,
		cwd,
		updatedAt: Date.now(),
		pid: process.ppid,
	};

	writeAgentState(state, filename);
}
