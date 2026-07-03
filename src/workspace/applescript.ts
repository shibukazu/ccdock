/** Escape a string for safe interpolation into an AppleScript double-quoted literal. */
export function escapeAppleScriptString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Run an AppleScript snippet and return its trimmed stdout. */
export async function runOsascript(script: string): Promise<string> {
	const proc = Bun.spawn(["osascript", "-e", script], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	if (proc.exitCode !== 0 && err.trim() && process.env.CCDOCK_DEBUG) {
		process.stderr.write(`[osascript] ${err.trim()}\n`);
	}
	return out.trim();
}
