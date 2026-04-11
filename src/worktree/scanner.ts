import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RepoInfo } from "../types.ts";

async function getDefaultBranch(repoPath: string): Promise<string> {
	try {
		const proc = Bun.spawn(["git", "-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		if (proc.exitCode === 0) {
			// refs/remotes/origin/main -> main
			const parts = output.trim().split("/");
			return parts[parts.length - 1] ?? "main";
		}
	} catch {
		// Fall through
	}

	// Fallback: check if main or master exists
	try {
		const proc = Bun.spawn(["git", "-C", repoPath, "branch", "--list", "main", "master"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		const branches = output
			.trim()
			.split("\n")
			.map((b) => b.trim().replace("* ", ""));
		if (branches.includes("main")) return "main";
		if (branches.includes("master")) return "master";
	} catch {
		// Fall through
	}

	return "main";
}

export async function scanRepos(workspaceDirs: string[]): Promise<RepoInfo[]> {
	// Collect all repo paths first
	const repoPaths: { name: string; path: string }[] = [];

	for (const dir of workspaceDirs) {
		if (!existsSync(dir)) continue;

		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}

		for (const entry of entries) {
			const fullPath = join(dir, entry);
			try {
				const stat = statSync(fullPath);
				if (!stat.isDirectory()) continue;

				const gitDir = join(fullPath, ".git");
				if (!existsSync(gitDir)) continue;

				repoPaths.push({ name: entry, path: fullPath });
			} catch {
				// Skip entries that can't be processed
			}
		}
	}

	// Resolve default branches in parallel
	const repos = await Promise.all(
		repoPaths.map(async ({ name, path }) => {
			const defaultBranch = await getDefaultBranch(path);
			return { name, path, defaultBranch };
		}),
	);

	return repos.sort((a, b) => a.name.localeCompare(b.name));
}
