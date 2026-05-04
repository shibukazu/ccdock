import { describe, expect, test } from "bun:test";
import { soundNameFromPath } from "../src/agent/notify.ts";

describe("soundNameFromPath", () => {
	test("extracts the bare sound name from a system sound path", () => {
		expect(soundNameFromPath("/System/Library/Sounds/Glass.aiff")).toBe("Glass");
		expect(soundNameFromPath("/System/Library/Sounds/Funk.aiff")).toBe("Funk");
	});

	test("returns undefined for non-system paths", () => {
		expect(soundNameFromPath("/tmp/custom.aiff")).toBeUndefined();
		expect(soundNameFromPath("/Users/me/Music/ding.wav")).toBeUndefined();
	});

	test("returns undefined for empty / undefined input", () => {
		expect(soundNameFromPath(undefined)).toBeUndefined();
		expect(soundNameFromPath("")).toBeUndefined();
	});
});
