import { describe, expect, test } from "bun:test";
import { formatElapsed } from "../src/tui/ansi.ts";

describe("formatElapsed", () => {
	test("renders seconds under a minute", () => {
		expect(formatElapsed(45_000)).toBe("45s");
	});

	test("renders minutes under an hour", () => {
		expect(formatElapsed(3 * 60_000)).toBe("3m");
	});

	test("renders hours and days at the thresholds", () => {
		expect(formatElapsed(2 * 60 * 60_000)).toBe("2h");
		expect(formatElapsed(25 * 60 * 60_000)).toBe("1d");
	});

	test("clamps negative durations to 0s", () => {
		expect(formatElapsed(-500)).toBe("0s");
	});
});
