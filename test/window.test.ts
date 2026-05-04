import { describe, expect, test } from "bun:test";
import {
	type EditorWindow,
	windowMatches,
	windowMatchesWorktree,
	windowMatchesWorktreePath,
} from "../src/workspace/window.ts";

const win = (title: string, documentPath: string | null = null): EditorWindow => ({
	title,
	documentPath,
});

describe("windowMatchesWorktree", () => {
	test("matches basename surrounded by em dash (VS Code workspace title)", () => {
		expect(windowMatchesWorktree("myfile.ts — foo — Visual Studio Code", "foo")).toBe(true);
		expect(windowMatchesWorktree("foo — Visual Studio Code", "foo")).toBe(true);
	});

	test("matches basename with hyphen inside", () => {
		expect(windowMatchesWorktree("src/file.ts — foo-bar — Visual Studio Code", "foo-bar")).toBe(
			true,
		);
	});

	test("does NOT match when basename is a substring of a different token", () => {
		expect(windowMatchesWorktree("src/file.ts — foo-bar — Visual Studio Code", "foo")).toBe(false);
		expect(windowMatchesWorktree("src/file.ts — foo-bar — Visual Studio Code", "bar")).toBe(false);
	});

	test("matches bounded by whitespace or slash", () => {
		expect(windowMatchesWorktree("path/to/foo/index.ts — repo", "foo")).toBe(true);
		expect(windowMatchesWorktree("foo", "foo")).toBe(true);
	});

	test("empty inputs return false", () => {
		expect(windowMatchesWorktree("", "foo")).toBe(false);
		expect(windowMatchesWorktree("anything", "")).toBe(false);
	});

	test("escapes regex metacharacters in basename", () => {
		expect(windowMatchesWorktree("foo.bar — repo", "foo.bar")).toBe(true);
		expect(windowMatchesWorktree("fooxbar — repo", "foo.bar")).toBe(false);
	});
});

describe("windowMatchesWorktreePath", () => {
	test("matches when document is inside the worktree", () => {
		expect(
			windowMatchesWorktreePath(
				win("file.ts — foo", "/repos/A/.wt/feat/foo/src/file.ts"),
				"/repos/A/.wt/feat/foo",
			),
		).toBe(true);
	});

	test("matches when document equals the worktree root exactly", () => {
		expect(
			windowMatchesWorktreePath(win("foo", "/repos/A/.wt/feat/foo"), "/repos/A/.wt/feat/foo"),
		).toBe(true);
	});

	test("does not match a sibling worktree even when basenames collide", () => {
		expect(
			windowMatchesWorktreePath(
				win("file.ts — foo", "/repos/B/.wt/feat/foo/src/file.ts"),
				"/repos/A/.wt/feat/foo",
			),
		).toBe(false);
	});

	test("requires a path separator boundary so /foo does not match /foobar", () => {
		expect(
			windowMatchesWorktreePath(win("x", "/repos/A/.wt/feat/foobar/x.ts"), "/repos/A/.wt/feat/foo"),
		).toBe(false);
	});

	test("returns false when no document path is exposed", () => {
		expect(windowMatchesWorktreePath(win("anything", null), "/repos/A/foo")).toBe(false);
	});
});

describe("windowMatches", () => {
	test("matches via AXDocument path when document lives under the worktree", () => {
		const w = win("file.ts — Visual Studio Code", "/repos/A/.wt/feat/foo/src/file.ts");
		expect(windowMatches(w, "/repos/A/.wt/feat/foo", "foo")).toBe(true);
	});

	test("falls back to basename when AXDocument is unavailable", () => {
		// VS Code views like PR diff tabs do not expose AXDocument; basename match kicks in.
		expect(windowMatches(win("foo — Visual Studio Code", null), "/anywhere/foo", "foo")).toBe(true);
	});

	test("does not match an unrelated window with a different basename even if AXDocument is missing", () => {
		expect(windowMatches(win("bar — Visual Studio Code", null), "/anywhere/foo", "foo")).toBe(
			false,
		);
	});

	test("path channel disambiguates when one window's document is outside the target worktree", () => {
		// Window A has a document inside /repos/A/foo -> matches A but not B.
		const a = win("file.ts — Visual Studio Code", "/repos/A/.wt/feat/foo/src/file.ts");
		expect(windowMatches(a, "/repos/A/.wt/feat/foo", "foo")).toBe(true);
		// Same window evaluated against an unrelated worktree with a different basename: no match.
		expect(windowMatches(a, "/repos/B/.wt/feat/bar", "bar")).toBe(false);
	});
});
