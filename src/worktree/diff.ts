export interface WorktreeDiff {
	files: number;
	additions: number;
	deletions: number;
}

// Parse `git diff --shortstat` output, e.g.
//   " 3 files changed, 12 insertions(+), 4 deletions(-)"
//   " 1 file changed, 2 insertions(+)"
//   " 1 file changed, 1 deletion(-)"
// Returns zeroed counts for empty/unparseable input.
export function parseShortstat(output: string): WorktreeDiff {
	const files = /(\d+) files? changed/.exec(output);
	const additions = /(\d+) insertions?\(\+\)/.exec(output);
	const deletions = /(\d+) deletions?\(-\)/.exec(output);
	return {
		files: files ? Number(files[1]) : 0,
		additions: additions ? Number(additions[1]) : 0,
		deletions: deletions ? Number(deletions[1]) : 0,
	};
}

// Count untracked files from `git status --porcelain` output. Untracked entries
// start with "?? "; they are not reflected in `diff --shortstat` so we add them
// to the changed-file count.
export function countUntracked(output: string): number {
	let count = 0;
	for (const line of output.split("\n")) {
		if (line.startsWith("?? ")) count++;
	}
	return count;
}

async function runGit(args: string[]): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		if (proc.exitCode !== 0) return null;
		return out;
	} catch {
		return null;
	}
}

// Compute the working-tree diff for a worktree: tracked changes vs HEAD plus
// untracked files. Returns null when git is unavailable or the path is not a
// git worktree.
export async function getWorktreeDiff(worktreePath: string): Promise<WorktreeDiff | null> {
	const [shortstat, status] = await Promise.all([
		runGit(["-C", worktreePath, "diff", "--shortstat", "HEAD"]),
		runGit(["-C", worktreePath, "status", "--porcelain"]),
	]);
	if (shortstat === null && status === null) return null;

	const diff = parseShortstat(shortstat ?? "");
	diff.files += countUntracked(status ?? "");
	return diff;
}
