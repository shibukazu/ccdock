import { describe, expect, test } from "bun:test";
import { normalizeFullwidth, parseKey, parseKeyWizard } from "../src/tui/input.ts";

describe("normalizeFullwidth", () => {
	test("maps fullwidth ASCII letters to halfwidth", () => {
		expect(normalizeFullwidth("\uFF4E")).toBe("n");
		expect(normalizeFullwidth("\uFF24")).toBe("D");
		expect(normalizeFullwidth("\uFF10\uFF11\uFF12")).toBe("012");
	});

	test("maps fullwidth space to regular space", () => {
		expect(normalizeFullwidth("\u3000")).toBe(" ");
	});

	test("passes through halfwidth ASCII unchanged", () => {
		expect(normalizeFullwidth("nqcrlx")).toBe("nqcrlx");
	});

	test("leaves non-ASCII runes (hiragana, kanji) alone", () => {
		expect(normalizeFullwidth("\u3042\u4e00")).toBe("\u3042\u4e00");
	});
});

describe("parseKey (sidebar)", () => {
	test("halfwidth shortcuts fire their actions", () => {
		expect(parseKey(Buffer.from("n"))).toEqual({ type: "new" });
		expect(parseKey(Buffer.from("d"))).toEqual({ type: "delete" });
		expect(parseKey(Buffer.from("q"))).toEqual({ type: "quit" });
		expect(parseKey(Buffer.from("j"))).toEqual({ type: "down" });
		expect(parseKey(Buffer.from("k"))).toEqual({ type: "up" });
		expect(parseKey(Buffer.from("c"))).toEqual({ type: "compact" });
		expect(parseKey(Buffer.from("l"))).toEqual({ type: "log" });
		expect(parseKey(Buffer.from("r"))).toEqual({ type: "realign" });
	});

	test("fullwidth shortcuts fire the same actions (IME on)", () => {
		expect(parseKey(Buffer.from("\uFF4E"))).toEqual({ type: "new" });
		expect(parseKey(Buffer.from("\uFF44"))).toEqual({ type: "delete" });
		expect(parseKey(Buffer.from("\uFF51"))).toEqual({ type: "quit" });
		expect(parseKey(Buffer.from("\uFF4A"))).toEqual({ type: "down" });
		expect(parseKey(Buffer.from("\uFF4B"))).toEqual({ type: "up" });
	});

	test("control codes", () => {
		expect(parseKey(Buffer.from("\r"))).toEqual({ type: "enter" });
		expect(parseKey(Buffer.from("\t"))).toEqual({ type: "tab" });
		expect(parseKey(Buffer.from("\x03"))).toEqual({ type: "quit" }); // Ctrl+C
	});

	test("arrow key escape sequences", () => {
		expect(parseKey(Buffer.from("\x1b[A"))).toEqual({ type: "up" });
		expect(parseKey(Buffer.from("\x1b[B"))).toEqual({ type: "down" });
	});

	test("SGR mouse click is parsed as mouse_click", () => {
		expect(parseKey(Buffer.from("\x1b[<0;12;5M"))).toEqual({
			type: "mouse_click",
			row: 5,
			col: 12,
		});
	});

	test("scroll wheel becomes up/down", () => {
		expect(parseKey(Buffer.from("\x1b[<64;1;1M"))).toEqual({ type: "up" });
		expect(parseKey(Buffer.from("\x1b[<65;1;1M"))).toEqual({ type: "down" });
	});

	test("unknown input yields unknown", () => {
		expect(parseKey(Buffer.from("z"))).toEqual({ type: "unknown" });
	});
});

describe("parseKeyWizard", () => {
	test("fullwidth char input is normalized to halfwidth", () => {
		expect(parseKeyWizard(Buffer.from("\uFF41"))).toEqual({ type: "char", char: "a" });
	});

	test("halfwidth printable chars pass through", () => {
		expect(parseKeyWizard(Buffer.from("a"))).toEqual({ type: "char", char: "a" });
	});

	test("escape and backspace", () => {
		expect(parseKeyWizard(Buffer.from("\x1b"))).toEqual({ type: "escape" });
		expect(parseKeyWizard(Buffer.from("\x03"))).toEqual({ type: "escape" });
		expect(parseKeyWizard(Buffer.from("\x7f"))).toEqual({ type: "backspace" });
	});

	test("non-ASCII runes yield unknown (IME unconfirmed preview is out of scope)", () => {
		expect(parseKeyWizard(Buffer.from("\u3042"))).toEqual({ type: "unknown" });
	});
});
