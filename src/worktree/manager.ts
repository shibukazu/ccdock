import { existsSync } from "node:fs";
import type { WorktreeEntry } from "../types.ts";

export async function createWorktree(repoPath: string, branchName: string): Promise<string> {
	const proc = Bun.spawn(["git", "wt", branchName], {
		cwd: repoPath,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(stderr.trim() || `git wt exited with code ${code}`);
	}

	// Parse worktree path from output - look for absolute paths
	const output = stdout.trim();
	const lines = output.split("\n");
	for (const line of [...lines].reverse()) {
		const trimmed = line.trim();
		if (trimmed.startsWith("/")) return trimmed;
	}

	// Fallback: find worktree via git worktree list
	const listProc = Bun.spawn(["git", "-C", repoPath, "worktree", "list", "--porcelain"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const listOutput = await new Response(listProc.stdout).text();
	await listProc.exited;

	let currentPath = "";
	for (const line of listOutput.split("\n")) {
		if (line.startsWith("worktree ")) currentPath = line.slice(9);
		else if (line.startsWith("branch ")) {
			const branch = line.slice(7).replace("refs/heads/", "");
			if (branch === branchName) return currentPath;
		}
	}

	throw new Error(`Could not determine worktree path from git wt output:\n${output}`);
}

export async function removeWorktree(worktreePath: string): Promise<void> {
	if (!existsSync(worktreePath)) return;

	// Find the main repo for this worktree
	const proc = Bun.spawn(["git", "-C", worktreePath, "worktree", "list", "--porcelain"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(proc.stdout).text();
	await proc.exited;

	// First entry in worktree list is the main worktree
	const lines = output.split("\n");
	const mainWorktreeLine = lines.find((l) => l.startsWith("worktree "));
	if (!mainWorktreeLine) {
		throw new Error("Could not determine main worktree");
	}
	const mainPath = mainWorktreeLine.replace("worktree ", "");

	// Remove the worktree
	const removeProc = Bun.spawn(
		["git", "-C", mainPath, "worktree", "remove", worktreePath, "--force"],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stderr = await new Response(removeProc.stderr).text();
	await removeProc.exited;

	if (removeProc.exitCode !== 0) {
		throw new Error(`Failed to remove worktree: ${stderr}`);
	}
}

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
	const proc = Bun.spawn(["git", "-C", repoPath, "worktree", "list", "--porcelain"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(proc.stdout).text();
	await proc.exited;

	if (proc.exitCode !== 0) return [];

	const entries: WorktreeEntry[] = [];
	const blocks = output.split("\n\n").filter((b) => b.trim());

	for (const block of blocks) {
		const lines = block.split("\n");
		let path = "";
		let branch = "";
		let isBare = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				path = line.replace("worktree ", "");
			} else if (line.startsWith("branch ")) {
				// refs/heads/main -> main
				const ref = line.replace("branch ", "");
				const parts = ref.split("/");
				branch = parts.slice(2).join("/");
			} else if (line === "bare") {
				isBare = true;
			}
		}

		if (path && !isBare) {
			entries.push({ path, branch });
		}
	}

	return entries;
}
