import type { ProcUsage } from "../types.ts";

export type { ProcUsage };

const kbToMb = (kb: number): number => Math.round(kb / 1024);

async function runPsLines(args: string[]): Promise<string[]> {
	try {
		const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		const lines: string[] = [];
		for (const line of out.split("\n")) {
			const trimmed = line.trim();
			if (trimmed) lines.push(trimmed);
		}
		return lines;
	} catch {
		return [];
	}
}

/**
 * Sample CPU% and RSS memory for a set of pids in one `ps` call.
 *
 * Returns a map keyed by pid. Pids that aren't alive (or aren't reported by
 * ps for any reason) are simply absent from the result.
 */
export async function sampleProcessUsage(pids: number[]): Promise<Map<number, ProcUsage>> {
	const result = new Map<number, ProcUsage>();
	const unique = Array.from(new Set(pids.filter((p) => Number.isFinite(p) && p > 0)));
	if (unique.length === 0) return result;

	const lines = await runPsLines(["ps", "-o", "pid=,pcpu=,rss=", "-p", unique.join(",")]);
	for (const line of lines) {
		const parts = line.split(/\s+/);
		if (parts.length < 3) continue;
		const pid = Number.parseInt(parts[0]!, 10);
		const cpu = Number.parseFloat(parts[1]!);
		const rssKb = Number.parseInt(parts[2]!, 10);
		if (!Number.isFinite(pid) || !Number.isFinite(cpu) || !Number.isFinite(rssKb)) continue;
		result.set(pid, { cpuPercent: cpu, memoryMb: kbToMb(rssKb) });
	}
	return result;
}

/**
 * Aggregate CPU% and RSS across every process whose command matches one of
 * the given patterns (case-insensitive substring match).
 *
 * VS Code spawns one main Electron process plus a handful of `Code Helper`
 * processes (renderer, GPU, extension host, utility…) per window. We sum all
 * of them so the sidebar reports the user's actual editor footprint, not just
 * one helper. Returns `null` when no matching process is alive.
 */
export async function sampleAppUsageByName(patterns: string[]): Promise<ProcUsage | null> {
	if (patterns.length === 0) return null;
	const lowered = patterns.map((p) => p.toLowerCase());

	const lines = await runPsLines(["ps", "-axo", "pcpu=,rss=,command="]);
	let totalCpu = 0;
	let totalRssKb = 0;
	let matched = 0;
	for (const line of lines) {
		// Cheap substring filter before splitting — ps -axo emits one line per
		// running process, so most lines won't match any pattern.
		const loweredLine = line.toLowerCase();
		if (!lowered.some((p) => loweredLine.includes(p))) continue;
		const parts = line.split(/\s+/);
		if (parts.length < 3) continue;
		const cpu = Number.parseFloat(parts[0]!);
		const rssKb = Number.parseInt(parts[1]!, 10);
		if (!Number.isFinite(cpu) || !Number.isFinite(rssKb)) continue;
		totalCpu += cpu;
		totalRssKb += rssKb;
		matched++;
	}
	if (matched === 0) return null;
	return { cpuPercent: totalCpu, memoryMb: kbToMb(totalRssKb) };
}
