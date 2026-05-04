import { existsSync } from "node:fs";
import type { WorktreeEntry } from "../types.ts";

export interface CreateWorktreeOptions {
	/** Run `git fetch origin <base>` before creating the worktree. */
	fetch?: boolean;
	/** Base branch to fetch (e.g. "main"). Only used when fetch is true. */
	base?: string;
}

async function fetchOrigin(repoPath: string, base: string): Promise<boolean> {
	const proc = Bun.spawn(["git", "-C", repoPath, "fetch", "origin", base], {
		stdout: "ignore",
		stderr: "pipe",
	});
	await proc.exited;
	return proc.exitCode === 0;
}

export async function createWorktree(
	repoPath: string,
	branchName: string,
	opts: CreateWorktreeOptions = {},
): Promise<string> {
	// When the user opted to "fetch origin first", branch from origin/<base>
	// directly so the new worktree reflects the latest remote state — not
	// whatever the local <base> happened to point at.
	let baseRef: string | null = null;
	if (opts.fetch && opts.base) {
		const fetched = await fetchOrigin(repoPath, opts.base);
		if (fetched) baseRef = `origin/${opts.base}`;
	}

	const args = baseRef ? ["git", "wt", branchName, baseRef] : ["git", "wt", branchName];
	const proc = Bun.spawn(args, {
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

/**
 * Create a worktree tracking a remote branch.
 * Uses `git wt <local> <remote>` first; if the installed git-wt doesn't accept
 * a base argument, falls back to `git worktree add -b <local> <path> <remote>`.
 */
export async function createWorktreeFromRemote(
	repoPath: string,
	localBranch: string,
	remoteRef: string,
): Promise<string> {
	const proc = Bun.spawn(["git", "wt", localBranch, remoteRef], {
		cwd: repoPath,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;

	if (code === 0) {
		const output = stdout.trim();
		for (const line of [...output.split("\n")].reverse()) {
			const trimmed = line.trim();
			if (trimmed.startsWith("/")) return trimmed;
		}
		// Fallback: find by branch name
		const found = await findWorktreePathByBranch(repoPath, localBranch);
		if (found) return found;
		throw new Error(`Could not determine worktree path from git wt output:\n${output}`);
	}

	// git wt failed — fall back to native git worktree add
	const parentDir = repoPath.replace(/\/[^/]+$/, "");
	const repoName = repoPath.split("/").pop() ?? "worktree";
	const safeBranch = localBranch.replace(/\//g, "-");
	const targetPath = `${parentDir}/${repoName}--${safeBranch}`;

	const addProc = Bun.spawn(
		["git", "-C", repoPath, "worktree", "add", "-b", localBranch, targetPath, remoteRef],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const addStderr = await new Response(addProc.stderr).text();
	await addProc.exited;
	if (addProc.exitCode !== 0) {
		throw new Error(addStderr.trim() || stderr.trim() || "worktree add failed");
	}
	return targetPath;
}

async function findWorktreePathByBranch(
	repoPath: string,
	branchName: string,
): Promise<string | null> {
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
	return null;
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
