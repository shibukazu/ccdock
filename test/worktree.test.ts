import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorktrees, removeWorktree } from "../src/worktree/manager.ts";

// These tests only cover operations that don't require git-wt.
// createWorktree / createWorktreeFromRemote call out to `git wt` which is an
// external dependency and is exercised via manual E2E.

let root: string;
let repo: string;

async function run(cmd: string[], cwd?: string): Promise<void> {
	const proc = Bun.spawn(cmd, {
		cwd,
		stdout: "ignore",
		stderr: "pipe",
	});
	const err = await new Response(proc.stderr).text();
	await proc.exited;
	if (proc.exitCode !== 0) {
		throw new Error(`${cmd.join(" ")} failed: ${err}`);
	}
}

beforeEach(async () => {
	// realpath to match what git returns (macOS tmpdir is a symlink to /private/var/...)
	root = realpathSync(mkdtempSync(join(tmpdir(), "ccdock-wt-")));
	repo = join(root, "repo");
	await run(["git", "init", "-q", "-b", "main", repo]);
	await run(["git", "-C", repo, "config", "user.email", "test@example.com"]);
	await run(["git", "-C", repo, "config", "user.name", "Test"]);
	writeFileSync(join(repo, "README.md"), "hello\n");
	await run(["git", "-C", repo, "add", "."]);
	await run(["git", "-C", repo, "commit", "-q", "-m", "init"]);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("listWorktrees", () => {
	test("returns the main worktree of a fresh repo", async () => {
		const worktrees = await listWorktrees(repo);
		expect(worktrees.length).toBe(1);
		expect(worktrees[0]?.branch).toBe("main");
		expect(worktrees[0]?.path).toBe(repo);
	});

	test("returns added worktrees", async () => {
		const wtPath = join(root, "feature");
		await run(["git", "-C", repo, "worktree", "add", "-b", "feature", wtPath]);
		const worktrees = await listWorktrees(repo);
		const branches = worktrees.map((w) => w.branch).sort();
		expect(branches).toEqual(["feature", "main"]);
	});
});

describe("removeWorktree", () => {
	test("removes an existing linked worktree", async () => {
		const wtPath = join(root, "feature");
		await run(["git", "-C", repo, "worktree", "add", "-b", "feature", wtPath]);
		expect(existsSync(wtPath)).toBe(true);

		await removeWorktree(wtPath);
		expect(existsSync(wtPath)).toBe(false);
	});

	test("is a no-op when path does not exist", async () => {
		await removeWorktree(join(root, "never-created"));
		// reached here without throwing
		expect(true).toBe(true);
	});
});
