/**
 * Sample CPU% and RSS memory for a set of pids in one `ps` call.
 *
 * Returns a map keyed by pid. Pids that aren't alive (or aren't reported by
 * ps for any reason) are simply absent from the result.
 */
export interface ProcUsage {
	cpuPercent: number;
	memoryMb: number;
}

export async function sampleProcessUsage(pids: number[]): Promise<Map<number, ProcUsage>> {
	const result = new Map<number, ProcUsage>();
	const unique = Array.from(new Set(pids.filter((p) => Number.isFinite(p) && p > 0)));
	if (unique.length === 0) return result;

	const args = ["ps", "-o", "pid=,pcpu=,rss=", "-p", unique.join(",")];
	try {
		const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		for (const line of out.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parts = trimmed.split(/\s+/);
			if (parts.length < 3) continue;
			const pid = Number.parseInt(parts[0]!, 10);
			const cpu = Number.parseFloat(parts[1]!);
			const rssKb = Number.parseInt(parts[2]!, 10);
			if (!Number.isFinite(pid) || !Number.isFinite(cpu) || !Number.isFinite(rssKb)) continue;
			result.set(pid, {
				cpuPercent: cpu,
				memoryMb: Math.round(rssKb / 1024),
			});
		}
	} catch {
		// ps unavailable — return whatever we collected (likely empty).
	}
	return result;
}
