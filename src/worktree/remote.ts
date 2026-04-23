/**
 * List remote branches on `origin` from the local cache.
 * Intentionally does NOT run `git fetch` because TUI is in raw mode and
 * cannot surface prompts like ssh passphrase entry. Users should refresh
 * their refs outside ccdock (e.g. `git fetch` in a shell) before creating
 * a worktree if they need the latest branches.
 */
export async function listRemoteBranches(repoPath: string): Promise<string[]> {
	const listProc = Bun.spawn(
		["git", "-C", repoPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"],
		{ stdout: "pipe", stderr: "ignore" },
	);
	const out = await new Response(listProc.stdout).text();
	await listProc.exited;

	return parseRemoteBranches(out);
}

/**
 * Pure parser over `git for-each-ref` output: keeps only `origin/<branch>`
 * refs, dropping `origin/HEAD` (which git may short-form to bare `origin`).
 */
export function parseRemoteBranches(output: string): string[] {
	return output
		.split("\n")
		.map((l) => l.trim())
		.filter(
			(l) =>
				l.startsWith("origin/") &&
				l.length > "origin/".length &&
				l !== "origin/HEAD" &&
				!l.includes("->"),
		);
}
