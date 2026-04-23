import { describe, expect, test } from "bun:test";
import { parseRemoteBranches } from "../src/worktree/remote.ts";

describe("parseRemoteBranches", () => {
	test("drops bare 'origin' (short-form of origin/HEAD)", () => {
		const out = "origin\norigin/main\norigin/feature-x";
		expect(parseRemoteBranches(out)).toEqual(["origin/main", "origin/feature-x"]);
	});

	test("drops explicit origin/HEAD", () => {
		const out = "origin/HEAD\norigin/main";
		expect(parseRemoteBranches(out)).toEqual(["origin/main"]);
	});

	test("drops arrow-style alias lines", () => {
		const out = "origin/HEAD -> origin/main\norigin/main";
		expect(parseRemoteBranches(out)).toEqual(["origin/main"]);
	});

	test("ignores non-origin refs defensively", () => {
		const out = "upstream/main\norigin/dev";
		expect(parseRemoteBranches(out)).toEqual(["origin/dev"]);
	});

	test("trims whitespace and drops empty lines", () => {
		const out = "  origin/main  \n\n  origin/feature  \n";
		expect(parseRemoteBranches(out)).toEqual(["origin/main", "origin/feature"]);
	});

	test("empty input returns empty array", () => {
		expect(parseRemoteBranches("")).toEqual([]);
	});
});
