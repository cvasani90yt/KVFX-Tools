import { describe, expect, it } from "vitest";
import { toExtendScriptLiteral } from "../src/protocol/literal.js";
import type { JsonValue } from "../src/protocol/json.js";

/**
 * The output of this serialiser is evaluated as source code by After Effects.
 * These tests are the security boundary — if one fails, treat it as a
 * vulnerability, not a formatting regression.
 */
describe("toExtendScriptLiteral — escaping", () => {
  it("escapes quotes and backslashes so a string cannot close early", () => {
    expect(toExtendScriptLiteral('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(toExtendScriptLiteral("back\\slash")).toBe('"back\\\\slash"');
  });

  it("neutralises an attempt to break out of the literal and append code", () => {
    const attack = '"; app.project.close(); var x = "';
    const literal = toExtendScriptLiteral(attack);

    // The payload survives as data...
    expect(JSON.parse(literal)).toBe(attack);
    // ...and contains no unescaped quote that could terminate the string.
    const body = literal.slice(1, -1);
    expect(/(?<!\\)"/.test(body)).toBe(false);
  });

  it("escapes newlines and control characters", () => {
    expect(toExtendScriptLiteral("a\nb")).toBe('"a\\u000ab"');
    expect(toExtendScriptLiteral("a\tb")).toBe('"a\\u0009b"');
    expect(toExtendScriptLiteral("\u0000")).toBe('"\\u0000"');
  });

  it("escapes line and paragraph separators", () => {
    // U+2028/U+2029 terminate a line in some parsers while looking like
    // whitespace; they must never be emitted raw.
    expect(toExtendScriptLiteral("a b")).toBe('"a\\u2028b"');
    expect(toExtendScriptLiteral("a b")).toBe('"a\\u2029b"');
  });

  it("emits pure ASCII for non-ASCII input, so host decoding cannot change meaning", () => {
    const literal = toExtendScriptLiteral("café — 日本語 — 🎬");
    expect(/^[\x20-\x7e]*$/.test(literal)).toBe(true);
    expect(JSON.parse(literal)).toBe("café — 日本語 — 🎬");
  });

  it("quotes object keys so a key can never become an identifier", () => {
    expect(toExtendScriptLiteral({ "var": 1, "a b": 2 })).toBe('{"var":1,"a b":2}');
  });

  it("escapes a malicious object key", () => {
    const literal = toExtendScriptLiteral({ '": 1, evil: (function(){return 2})(), "x': 3 });
    expect(JSON.parse(literal)).toEqual({ '": 1, evil: (function(){return 2})(), "x': 3 });
  });
});

describe("toExtendScriptLiteral — value types", () => {
  it("serialises primitives", () => {
    expect(toExtendScriptLiteral(null)).toBe("null");
    expect(toExtendScriptLiteral(true)).toBe("true");
    expect(toExtendScriptLiteral(false)).toBe("false");
    expect(toExtendScriptLiteral(42)).toBe("42");
    expect(toExtendScriptLiteral(-1.5)).toBe("-1.5");
  });

  it("serialises nested structures", () => {
    const value: JsonValue = { ids: [1, 2], nested: { flag: true, name: "x" } };
    expect(JSON.parse(toExtendScriptLiteral(value))).toEqual(value);
  });

  it("serialises empty containers", () => {
    expect(toExtendScriptLiteral([])).toBe("[]");
    expect(toExtendScriptLiteral({})).toBe("{}");
  });

  it("rejects non-finite numbers", () => {
    expect(() => toExtendScriptLiteral(Number.NaN)).toThrow(/Non-finite/);
    expect(() => toExtendScriptLiteral(Number.POSITIVE_INFINITY)).toThrow(/Non-finite/);
  });

  it("rejects undefined properties rather than dropping them silently", () => {
    const value = { a: 1, b: undefined } as unknown as JsonValue;
    expect(() => toExtendScriptLiteral(value)).toThrow(/undefined/);
  });

  it("rejects functions", () => {
    const value = { run: () => 1 } as unknown as JsonValue;
    expect(() => toExtendScriptLiteral(value)).toThrow(/Unsupported value type/);
  });

  it("rejects non-plain objects", () => {
    expect(() => toExtendScriptLiteral(new Date() as unknown as JsonValue)).toThrow(/plain objects/);
    class Custom {
      x = 1;
    }
    expect(() => toExtendScriptLiteral(new Custom() as unknown as JsonValue)).toThrow(/plain objects/);
  });

  it("rejects sparse arrays", () => {
    // eslint-disable-next-line no-sparse-arrays -- the hole is the subject of this test
    const sparse = [1, , 3] as unknown as JsonValue;
    expect(() => toExtendScriptLiteral(sparse)).toThrow(/Sparse/);
  });

  it("rejects cycles instead of overflowing the stack", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    expect(() => toExtendScriptLiteral(a as JsonValue)).toThrow(/cycle/);
  });

  it("rejects values nested past the depth limit", () => {
    let deep: JsonValue = 1;
    for (let i = 0; i < 40; i += 1) deep = { deep };
    expect(() => toExtendScriptLiteral(deep)).toThrow(/nested deeper/);
  });

  it("allows a sibling reference that is not a cycle", () => {
    const shared = { n: 1 };
    const value = { a: shared, b: shared } as unknown as JsonValue;
    expect(JSON.parse(toExtendScriptLiteral(value))).toEqual({ a: { n: 1 }, b: { n: 1 } });
  });
});
