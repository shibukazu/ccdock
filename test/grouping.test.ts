import { describe, expect, test } from "bun:test";
import { groupOfSession, sortSessionsByGroup } from "../src/tui/grouping.ts";
import type { AgentState, AgentStatus, EditorState, WorkspaceSession } from "../src/types.ts";

function agent(status: AgentStatus): AgentState {
	return {
		sessionId: "s",
		agentType: "claude-code",
		status,
		prompt: "",
		toolName: "",
		toolDetail: "",
		cwd: "",
		updatedAt: 0,
	};
}

function session(
	id: string,
	opts: { agents?: AgentState[]; editor?: EditorState; terminal?: EditorState } = {},
): WorkspaceSession {
	return {
		id,
		sessionName: id,
		worktreePath: `/wt/${id}`,
		branch: id,
		repoName: "repo",
		agents: opts.agents ?? [],
		editorState: opts.editor ?? "closed",
		terminalState: opts.terminal ?? "closed",
		createdAt: 0,
		lastActiveAt: 0,
	};
}

describe("groupOfSession", () => {
	test("running/waiting agents are active", () => {
		expect(groupOfSession(session("a", { agents: [agent("running")] }))).toBe("active");
		expect(groupOfSession(session("a", { agents: [agent("waiting")] }))).toBe("active");
	});

	test("open editor or terminal without active agent is ready", () => {
		expect(groupOfSession(session("a", { editor: "open" }))).toBe("ready");
		expect(groupOfSession(session("a", { terminal: "focused" }))).toBe("ready");
	});

	test("both windows closed and no active agent is closed", () => {
		expect(groupOfSession(session("a", { agents: [agent("stopped")] }))).toBe("closed");
	});
});

describe("sortSessionsByGroup", () => {
	test("orders active before ready before closed, stable within a group", () => {
		const input = [
			session("closed1"),
			session("ready1", { editor: "open" }),
			session("active1", { agents: [agent("running")] }),
			session("ready2", { terminal: "open" }),
			session("active2", { agents: [agent("waiting")] }),
		];
		expect(sortSessionsByGroup(input).map((s) => s.id)).toEqual([
			"active1",
			"active2",
			"ready1",
			"ready2",
			"closed1",
		]);
	});
});
