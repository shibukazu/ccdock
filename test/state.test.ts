import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentState, WorkspaceSession } from "../src/types.ts";

// state.ts resolves its directories lazily from XDG_STATE_HOME / HOME each call.
// We redirect them to a temp dir for each test.

let stateRoot: string;
let originalXdg: string | undefined;

beforeEach(() => {
	stateRoot = mkdtempSync(join(tmpdir(), "ccdock-state-"));
	originalXdg = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = stateRoot;
});

afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
	else process.env.XDG_STATE_HOME = originalXdg;
	rmSync(stateRoot, { recursive: true, force: true });
});

function writeAgent(filename: string, state: AgentState): string {
	const dir = join(stateRoot, "ccdock", "agents");
	mkdirSync(dir, { recursive: true });
	const p = join(dir, filename);
	writeFileSync(p, JSON.stringify(state));
	return p;
}

function writeSession(session: WorkspaceSession): void {
	const dir = join(stateRoot, "ccdock", "sessions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${session.id}.json`), JSON.stringify(session));
}

function buildSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
	return {
		id: "sess1",
		sessionName: "repo:main",
		worktreePath: "/tmp/repo",
		branch: "main",
		repoName: "repo",
		agents: [],
		editorState: "open",
		createdAt: 0,
		lastActiveAt: 0,
		...overrides,
	};
}

function buildAgent(overrides: Partial<AgentState> = {}): AgentState {
	return {
		sessionId: "sess1",
		agentType: "claude-code",
		status: "idle",
		prompt: "",
		toolName: "",
		toolDetail: "",
		cwd: "/tmp/repo",
		updatedAt: Date.now(),
		...overrides,
	};
}

describe("cleanStaleAgents", () => {
	test("keeps stopped agent regardless of age", async () => {
		const { cleanStaleAgents } = await import(`../src/workspace/state.ts?t=${Date.now()}`);
		writeSession(buildSession());
		const p = writeAgent(
			"a.json",
			buildAgent({
				status: "stopped",
				updatedAt: Date.now() - 999 * 60 * 60 * 1000, // very old
			}),
		);
		cleanStaleAgents();
		expect(existsSync(p)).toBe(true);
	});

	test("keeps idle agent regardless of age", async () => {
		const { cleanStaleAgents } = await import(`../src/workspace/state.ts?t=${Date.now()}`);
		writeSession(buildSession());
		const p = writeAgent(
			"b.json",
			buildAgent({ status: "idle", updatedAt: Date.now() - 999 * 60 * 60 * 1000 }),
		);
		cleanStaleAgents();
		expect(existsSync(p)).toBe(true);
	});

	test("removes transient (running) agent older than 30 minutes", async () => {
		const { cleanStaleAgents } = await import(`../src/workspace/state.ts?t=${Date.now()}`);
		writeSession(buildSession());
		const p = writeAgent(
			"c.json",
			buildAgent({ status: "running", updatedAt: Date.now() - 31 * 60 * 1000 }),
		);
		cleanStaleAgents();
		expect(existsSync(p)).toBe(false);
	});

	test("keeps running agent younger than 30 minutes", async () => {
		const { cleanStaleAgents } = await import(`../src/workspace/state.ts?t=${Date.now()}`);
		writeSession(buildSession());
		const p = writeAgent(
			"d.json",
			buildAgent({ status: "running", updatedAt: Date.now() - 60 * 1000 }),
		);
		cleanStaleAgents();
		expect(existsSync(p)).toBe(true);
	});

	test("removes orphan agent (no matching session)", async () => {
		const { cleanStaleAgents } = await import(`../src/workspace/state.ts?t=${Date.now()}`);
		// No session written — agent has no home
		const p = writeAgent(
			"orphan.json",
			buildAgent({
				status: "stopped",
				sessionId: "",
				cwd: "/some/unknown/path",
				updatedAt: Date.now(),
			}),
		);
		cleanStaleAgents();
		expect(existsSync(p)).toBe(false);
	});

	test("keeps agent whose cwd is a prefix of a known session worktreePath", async () => {
		const { cleanStaleAgents } = await import(`../src/workspace/state.ts?t=${Date.now()}`);
		writeSession(buildSession({ worktreePath: "/tmp/repo" }));
		const p = writeAgent(
			"e.json",
			buildAgent({
				sessionId: "", // no direct match
				cwd: "/tmp/repo/subdir",
				status: "idle",
				updatedAt: Date.now(),
			}),
		);
		cleanStaleAgents();
		expect(existsSync(p)).toBe(true);
	});
});
