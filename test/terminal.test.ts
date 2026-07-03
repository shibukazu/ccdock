import { describe, expect, test } from "bun:test";
import { type TerminalWindow, terminalMatchesWorktree } from "../src/workspace/terminal.ts";

const win = (workingDirectory: string): TerminalWindow => ({
	id: "tab-group-x",
	name: "window",
	workingDirectory,
});

describe("terminalMatchesWorktree", () => {
	test("matches when the terminal cwd equals the worktree root", () => {
		expect(terminalMatchesWorktree(win("/repos/A/.wt/feat/foo"), "/repos/A/.wt/feat/foo")).toBe(
			true,
		);
	});

	test("matches when the terminal cwd is inside the worktree", () => {
		expect(terminalMatchesWorktree(win("/repos/A/.wt/feat/foo/src"), "/repos/A/.wt/feat/foo")).toBe(
			true,
		);
	});

	test("does not match a sibling worktree with the same basename", () => {
		expect(terminalMatchesWorktree(win("/repos/B/.wt/feat/foo"), "/repos/A/.wt/feat/foo")).toBe(
			false,
		);
	});

	test("requires a path boundary so /foo does not match /foobar", () => {
		expect(terminalMatchesWorktree(win("/repos/A/.wt/feat/foobar"), "/repos/A/.wt/feat/foo")).toBe(
			false,
		);
	});

	test("empty inputs return false", () => {
		expect(terminalMatchesWorktree(win(""), "/repos/A/foo")).toBe(false);
		expect(terminalMatchesWorktree(win("/repos/A/foo"), "")).toBe(false);
	});
});
