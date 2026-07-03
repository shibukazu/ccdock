import { describe, expect, test } from "bun:test";
import { countUntracked, parseShortstat } from "../src/worktree/diff.ts";

describe("parseShortstat", () => {
	test("parses files, insertions, and deletions", () => {
		expect(parseShortstat(" 3 files changed, 12 insertions(+), 4 deletions(-)")).toEqual({
			files: 3,
			additions: 12,
			deletions: 4,
		});
	});

	test("parses singular forms with only insertions", () => {
		expect(parseShortstat(" 1 file changed, 2 insertions(+)")).toEqual({
			files: 1,
			additions: 2,
			deletions: 0,
		});
	});

	test("returns zeros for empty output", () => {
		expect(parseShortstat("")).toEqual({ files: 0, additions: 0, deletions: 0 });
	});
});

describe("countUntracked", () => {
	test("counts only untracked (??) entries", () => {
		const status = "?? new.ts\n M tracked.ts\n?? other.ts\n";
		expect(countUntracked(status)).toBe(2);
	});

	test("returns 0 when there are no untracked files", () => {
		expect(countUntracked(" M a.ts\nA  b.ts\n")).toBe(0);
	});
});
