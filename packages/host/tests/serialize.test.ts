import { describe, expect, it } from "vitest";
import { isPureAscii, stringify } from "../src/runtime/serialize.js";

describe("stringify", () => {
  it("matches JSON.stringify for ordinary values", () => {
    const value = { a: 1, b: "x", c: true, d: null, e: [1, 2, { f: false }] };
    expect(JSON.parse(stringify(value))).toEqual(value);
  });

  it("escapes quotes, backslashes and control characters", () => {
    expect(JSON.parse(stringify('he said "hi"\\ok\n'))).toBe('he said "hi"\\ok\n');
  });

  it("emits pure ASCII so host text encoding cannot corrupt a layer name", () => {
    const out = stringify({ name: "Ébauche — 日本語 🎬" });
    expect(isPureAscii(out)).toBe(true);
    expect(JSON.parse(out)).toEqual({ name: "Ébauche — 日本語 🎬" });
  });

  it("escapes line and paragraph separators", () => {
    expect(isPureAscii(stringify("a\u2028b\u2029c"))).toBe(true);
    expect(JSON.parse(stringify("a\u2028b\u2029c"))).toBe("a\u2028b\u2029c");
  });

  it("degrades non-finite numbers to null, as JSON requires", () => {
    expect(JSON.parse(stringify({ a: Number.NaN, b: Number.POSITIVE_INFINITY }))).toEqual({
      a: null,
      b: null,
    });
  });

  it("skips undefined and function properties", () => {
    const value = { a: 1, b: undefined, c: () => 1 } as unknown as Record<string, never>;
    expect(JSON.parse(stringify(value))).toEqual({ a: 1 });
  });

  it("marks a cycle instead of overflowing the stack", () => {
    const a: Record<string, unknown> = { name: "root" };
    a["self"] = a;
    const parsed = JSON.parse(stringify(a as never)) as Record<string, unknown>;
    expect(parsed["self"]).toBe("[circular]");
  });

  it("allows the same object to appear twice as a sibling", () => {
    const shared = { n: 1 };
    expect(JSON.parse(stringify({ a: shared, b: shared }))).toEqual({
      a: { n: 1 },
      b: { n: 1 },
    });
  });

  it("bounds depth instead of recursing without limit", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 40; i += 1) deep = { deep };
    expect(stringify(deep as never)).toContain("[max depth exceeded]");
  });

  it("produces valid JSON for empty containers", () => {
    expect(stringify([])).toBe("[]");
    expect(stringify({})).toBe("{}");
  });
});
