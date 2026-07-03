import { describe, expect, test } from "bun:test";
import { matchesFilter } from "../src/tui/list.ts";

describe("matchesFilter", () => {
	test("matches case-insensitively", () => {
		expect(matchesFilter("Feature-Branch", "branch")).toBe(true);
	});

	test("returns false when text does not contain filter", () => {
		expect(matchesFilter("Feature-Branch", "nope")).toBe(false);
	});

	test("matches everything when filter is empty", () => {
		expect(matchesFilter("anything", "")).toBe(true);
	});
});
