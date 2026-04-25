import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentState, WorkspaceSession } from "../types.ts";

const STATE_DIR_NAME = "ccdock";
// Agents in a transient state (running/waiting) are staled after 30 minutes
// without updates. "stopped" (Stop event received) and "idle" (no work yet)
// are never staled so completed/ready sessions stay visible indefinitely.
const STALE_TRANSIENT_THRESHOLD_MS = 30 * 60 * 1000;

export function getStateDir(): string {
	const home = process.env.HOME ?? "";
	const stateBase = process.env.XDG_STATE_HOME ?? join(home, ".local", "state");
	return join(stateBase, STATE_DIR_NAME);
}

function getSessionsDir(): string {
	return join(getStateDir(), "sessions");
}

function getAgentsDir(): string {
	return join(getStateDir(), "agents");
}

let dirsEnsured = false;

function ensureDirs(): void {
	if (dirsEnsured) return;
	const sessionsDir = getSessionsDir();
	const agentsDir = getAgentsDir();
	if (!existsSync(sessionsDir)) {
		mkdirSync(sessionsDir, { recursive: true });
	}
	if (!existsSync(agentsDir)) {
		mkdirSync(agentsDir, { recursive: true });
	}
	dirsEnsured = true;
}

export function saveSession(session: WorkspaceSession): void {
	ensureDirs();
	const filePath = join(getSessionsDir(), `${session.id}.json`);
	const { agents: _agents, editorState: _editorState, ...serializable } = session;
	writeFileSync(filePath, JSON.stringify(serializable, null, 2));
}

export function loadSessions(): WorkspaceSession[] {
	ensureDirs();
	const sessionsDir = getSessionsDir();
	const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
	const sessions: WorkspaceSession[] = [];

	for (const file of files) {
		try {
			const raw = readFileSync(join(sessionsDir, file), "utf-8");
			const parsed = JSON.parse(raw) as WorkspaceSession;
			parsed.agents = [];
			parsed.editorState = parsed.editorState ?? "closed";
			sessions.push(parsed);
		} catch {
			// Skip malformed files
		}
	}

	return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export function deleteSession(id: string): void {
	const filePath = join(getSessionsDir(), `${id}.json`);
	if (existsSync(filePath)) {
		unlinkSync(filePath);
	}
}

export function loadAgentStates(): AgentState[] {
	ensureDirs();
	const agentsDir = getAgentsDir();
	const files = readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
	const states: AgentState[] = [];

	for (const file of files) {
		try {
			const raw = readFileSync(join(agentsDir, file), "utf-8");
			const parsed = JSON.parse(raw) as AgentState;
			states.push(parsed);
		} catch {
			// Skip malformed files
		}
	}

	return states;
}

export function cleanStaleAgents(): void {
	ensureDirs();
	const agentsDir = getAgentsDir();
	const files = readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
	const now = Date.now();
	const sessions = loadSessions();
	const sessionPaths = sessions.map((s) => s.worktreePath);
	const sessionIds = new Set(sessions.map((s) => s.id));

	for (const file of files) {
		try {
			const filePath = join(agentsDir, file);
			const raw = readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(raw) as AgentState;

			// Orphan check: agent belongs to no known session (neither by id nor by cwd prefix)
			const hasSession =
				(parsed.sessionId && sessionIds.has(parsed.sessionId)) ||
				sessionPaths.some((p) => parsed.cwd === p || parsed.cwd.startsWith(`${p}/`));
			if (!hasSession) {
				unlinkSync(filePath);
				continue;
			}

			// "stopped" (completed) and "idle" (not yet started) are preserved indefinitely
			if (parsed.status === "stopped" || parsed.status === "idle") continue;

			if (now - parsed.updatedAt > STALE_TRANSIENT_THRESHOLD_MS) {
				unlinkSync(filePath);
			}
		} catch {
			// Skip
		}
	}
}

export function findSessionByPath(cwd: string): string {
	const sessions = loadSessions();
	// Sort by path length descending to match the most specific session first
	// (e.g. /repo/.wt/fix/foo before /repo)
	const sorted = [...sessions].sort((a, b) => b.worktreePath.length - a.worktreePath.length);
	for (const session of sorted) {
		if (cwd === session.worktreePath || cwd.startsWith(`${session.worktreePath}/`)) {
			return session.id;
		}
	}
	return "";
}

export function readAgentState(filename: string): AgentState | null {
	const filePath = join(getAgentsDir(), filename);
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as AgentState;
	} catch {
		return null;
	}
}

export function writeAgentState(state: AgentState, filename: string): void {
	ensureDirs();
	const filePath = join(getAgentsDir(), filename);
	writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function removeAgentFile(filename: string): void {
	const filePath = join(getAgentsDir(), filename);
	if (existsSync(filePath)) {
		unlinkSync(filePath);
	}
}
