import { describe, expect, test } from "bun:test";
import { computeListWindow, matchesFilter } from "../src/tui/list.ts";

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

describe("computeListWindow", () => {
	test("returns full range when total fits within maxVisible", () => {
		expect(computeListWindow(5, 2, 10)).toEqual({ start: 0, end: 5 });
	});

	test("centers window on selection near the start", () => {
		expect(computeListWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
	});

	test("clamps window so end does not exceed total near the end", () => {
		expect(computeListWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
	});

	test("centers window around selection in the middle", () => {
		expect(computeListWindow(20, 10, 5)).toEqual({ start: 8, end: 13 });
	});

	test("returns empty range for non-positive total or maxVisible", () => {
		expect(computeListWindow(0, 0, 5)).toEqual({ start: 0, end: 0 });
		expect(computeListWindow(10, 0, 0)).toEqual({ start: 0, end: 0 });
	});
});
