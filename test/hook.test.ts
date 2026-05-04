import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentState } from "../src/types.ts";

let stateRoot: string;
const MAIN = join(import.meta.dir, "..", "src", "main.ts");

beforeEach(() => {
	stateRoot = mkdtempSync(join(tmpdir(), "ccdock-hook-"));
});

afterEach(() => {
	rmSync(stateRoot, { recursive: true, force: true });
});

async function runHook(event: string, payload: Record<string, unknown>): Promise<void> {
	const proc = Bun.spawn(["bun", "run", MAIN, "hook", "claude-code", event], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, XDG_STATE_HOME: stateRoot },
	});
	proc.stdin.write(JSON.stringify(payload));
	await proc.stdin.end();
	await proc.exited;
}

function agentsDir(): string {
	return join(stateRoot, "ccdock", "agents");
}

function readOnlyAgent(): AgentState {
	const files = readdirSync(agentsDir()).filter((f) => f.endsWith(".json"));
	expect(files.length).toBe(1);
	const raw = readFileSync(join(agentsDir(), files[0]!), "utf-8");
	return JSON.parse(raw) as AgentState;
}

describe("ccdock hook", () => {
	test("PreToolUse writes a running agent state", async () => {
		await runHook("PreToolUse", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
			tool_name: "Bash",
			tool_input: { command: "ls" },
		});
		const state = readOnlyAgent();
		expect(state.status).toBe("running");
		expect(state.toolName).toBe("Bash");
		expect(state.toolDetail).toBe("ls");
	});

	test("Stop writes stopped (not idle)", async () => {
		await runHook("Stop", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
			stop_reason: "completed",
		});
		const state = readOnlyAgent();
		expect(state.status).toBe("stopped");
	});

	test("PermissionRequest writes waiting", async () => {
		await runHook("PermissionRequest", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
		});
		const state = readOnlyAgent();
		expect(state.status).toBe("waiting");
	});

	test("SessionEnd removes the agent file", async () => {
		await runHook("PreToolUse", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
			tool_name: "Read",
			tool_input: { file_path: "/tmp/x" },
		});
		expect(readdirSync(agentsDir()).length).toBe(1);

		await runHook("SessionEnd", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
		});
		expect(readdirSync(agentsDir()).length).toBe(0);
	});

	test("Notification preserves previous state and only bumps updatedAt", async () => {
		await runHook("PreToolUse", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
			tool_name: "Bash",
			tool_input: { command: "echo hi" },
		});
		const before = readOnlyAgent();

		// brief wait to ensure updatedAt differs
		await Bun.sleep(20);

		await runHook("Notification", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
		});
		const after = readOnlyAgent();

		expect(after.status).toBe(before.status);
		expect(after.toolName).toBe(before.toolName);
		expect(after.toolDetail).toBe(before.toolDetail);
		expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
	});

	test("Stop clears toolName/toolDetail", async () => {
		await runHook("PreToolUse", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
			tool_name: "Bash",
			tool_input: { command: "something" },
		});
		await runHook("Stop", {
			session_id: "sess-abc",
			cwd: "/tmp/workspace/repo",
		});
		const state = readOnlyAgent();
		expect(state.status).toBe("stopped");
		expect(state.toolName).toBe("");
	});

	test("missing session_id does nothing (no file created)", async () => {
		await runHook("PreToolUse", { cwd: "/tmp/workspace/repo" });
		if (existsSync(agentsDir())) {
			expect(readdirSync(agentsDir()).length).toBe(0);
		}
	});

	test("subagent invocation (parent_tool_use_id present) is ignored", async () => {
		await runHook("PreToolUse", {
			session_id: "sess-child",
			parent_tool_use_id: "tool-abc",
			cwd: "/tmp/workspace/repo",
			tool_name: "Bash",
			tool_input: { command: "ls" },
		});
		if (existsSync(agentsDir())) {
			expect(readdirSync(agentsDir()).length).toBe(0);
		}
	});
});
