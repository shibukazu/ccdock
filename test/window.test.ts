import { describe, expect, test } from "bun:test";
import { windowMatchesWorktree } from "../src/workspace/window.ts";

describe("windowMatchesWorktree", () => {
	test("matches basename surrounded by em dash (VS Code workspace title)", () => {
		expect(windowMatchesWorktree("myfile.ts \u2014 foo \u2014 Visual Studio Code", "foo")).toBe(
			true,
		);
		expect(windowMatchesWorktree("foo \u2014 Visual Studio Code", "foo")).toBe(true);
	});

	test("matches basename with hyphen inside", () => {
		expect(
			windowMatchesWorktree("src/file.ts \u2014 foo-bar \u2014 Visual Studio Code", "foo-bar"),
		).toBe(true);
	});

	test("does NOT match when basename is a substring of a different token", () => {
		// "foo" must not match a window for "foo-bar"
		expect(
			windowMatchesWorktree("src/file.ts \u2014 foo-bar \u2014 Visual Studio Code", "foo"),
		).toBe(false);
		// "bar" must not match a window for "foo-bar"
		expect(
			windowMatchesWorktree("src/file.ts \u2014 foo-bar \u2014 Visual Studio Code", "bar"),
		).toBe(false);
	});

	test("matches bounded by whitespace or slash", () => {
		expect(windowMatchesWorktree("path/to/foo/index.ts \u2014 repo", "foo")).toBe(true);
		expect(windowMatchesWorktree("foo", "foo")).toBe(true);
	});

	test("empty inputs return false", () => {
		expect(windowMatchesWorktree("", "foo")).toBe(false);
		expect(windowMatchesWorktree("anything", "")).toBe(false);
	});

	test("escapes regex metacharacters in basename", () => {
		expect(windowMatchesWorktree("foo.bar \u2014 repo", "foo.bar")).toBe(true);
		// Not a regex wildcard: "foo.bar" should not match "fooxbar"
		expect(windowMatchesWorktree("fooxbar \u2014 repo", "foo.bar")).toBe(false);
	});
});
