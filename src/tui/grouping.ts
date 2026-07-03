import type { WorkspaceSession } from "../types.ts";

// Session groups, in display order (orca-style state grouping):
//   Active — any agent is running or waiting.
//   Ready  — not active, but the editor or terminal window is not closed.
//   Closed — both editor and terminal windows are closed.
export type SessionGroup = "active" | "ready" | "closed";

export const GROUP_ORDER: readonly SessionGroup[] = ["active", "ready", "closed"];

export const GROUP_LABELS: Record<SessionGroup, string> = {
	active: "Active",
	ready: "Ready",
	closed: "Closed",
};

export function groupOfSession(session: WorkspaceSession): SessionGroup {
	const isActive = session.agents.some((a) => a.status === "running" || a.status === "waiting");
	if (isActive) return "active";
	const editorClosed = session.editorState === "closed";
	const terminalClosed = session.terminalState === "closed";
	if (!editorClosed || !terminalClosed) return "ready";
	return "closed";
}

// Stable sort of sessions by group (active → ready → closed). Within a group the
// original (load) order is preserved so j/k navigation and click targets stay
// predictable across refreshes.
export function sortSessionsByGroup(sessions: WorkspaceSession[]): WorkspaceSession[] {
	const rank: Record<SessionGroup, number> = { active: 0, ready: 1, closed: 2 };
	return sessions
		.map((session, index) => ({ session, index, group: groupOfSession(session) }))
		.sort((a, b) => rank[a.group] - rank[b.group] || a.index - b.index)
		.map((entry) => entry.session);
}
