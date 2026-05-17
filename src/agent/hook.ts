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

const NOTIFY_DEBOUNCE_MS = 3000;

function pickSoundFile(eventName: string, sound: HubConfig["sound"]): string {
	if (eventName === "PermissionRequest") return sound.permission_request;
	return sound.notification;
}

/**
 * Macos Notification Center plays its own sound, so when we post one we
 * suppress the standalone afplay path to avoid a double-beep.
 *
 * Skips emission entirely when the previous alert for this agent fired within
 * NOTIFY_DEBOUNCE_MS — Claude Code can emit Notification (idle_prompt) and
 * Stop back-to-back at turn end, which would otherwise double-beep.
 *
 * Returns true when a notification or sound was emitted so the caller can
 * record `lastNotifiedAt`.
 */
function reactToEvent(
	eventName: string,
	payload: Record<string, unknown>,
	lastNotifiedAt: number | undefined,
	now: number,
): boolean {
	if (process.env.CCDOCK_SILENT === "1") return false;
	if (process.platform !== "darwin") return false;
	if (lastNotifiedAt !== undefined && now - lastNotifiedAt < NOTIFY_DEBOUNCE_MS) return false;

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
		return true;
	}

	if (!ATTENTION_EVENTS.has(eventName)) return false;
	if (!config.sound.enabled || !soundFile) return false;
	try {
		// Detach so the hook can return without blocking on afplay's playback
		// duration — otherwise the parent agent waits for the sound to finish.
		const proc = Bun.spawn(["afplay", soundFile], {
			stdout: "ignore",
			stderr: "ignore",
		});
		proc.unref();
		return true;
	} catch {
		// afplay missing — ignore.
		return false;
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

	// Sounds always fire on PermissionRequest / Notification (legacy default);
	// Mac notifications fire on whatever events the config subscribes to.
	const prevState = readAgentState(filename);
	const now = Date.now();
	const emitted = reactToEvent(eventName, payload, prevState?.lastNotifiedAt, now);
	const lastNotifiedAt = emitted ? now : prevState?.lastNotifiedAt;

	// Notification doesn't carry meaningful status info — preserve previous state
	if (eventName === "Notification") {
		if (prevState) {
			prevState.updatedAt = now;
			if (lastNotifiedAt !== undefined) prevState.lastNotifiedAt = lastNotifiedAt;
			writeAgentState(prevState, filename);
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
	if (!toolName && status !== "stopped" && prevState) {
		toolName = prevState.toolName ?? "";
		toolDetail = prevState.toolDetail ?? "";
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
		updatedAt: now,
		pid: process.ppid,
		lastNotifiedAt,
	};

	writeAgentState(state, filename);
}
