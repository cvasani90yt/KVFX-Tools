import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGET_MS,
  MAX_BUDGET_MS,
  PROTOCOL_VERSION,
  buildRequest,
  parseResponse,
} from "../src/protocol/envelope.js";

describe("buildRequest", () => {
  it("stamps the protocol version and default budget", () => {
    const r = buildRequest({ id: "r1", kind: "query", op: "kvfx.op.system.ping" });
    expect(r.v).toBe(PROTOCOL_VERSION);
    expect(r.budgetMs).toBe(DEFAULT_BUDGET_MS);
    expect(r.args).toEqual({});
  });

  it("rejects a malformed operation id", () => {
    expect(() => buildRequest({ id: "r1", kind: "op", op: "ping" })).toThrow(/Malformed/);
    expect(() => buildRequest({ id: "r1", kind: "op", op: "kvfx.op.Ping" })).toThrow(/Malformed/);
    expect(() => buildRequest({ id: "r1", kind: "op", op: "kvfx.op.system" })).toThrow(/Malformed/);
  });

  it("refuses a budget above the hard ceiling", () => {
    // After Effects is frozen for the whole host call, so this is a
    // responsiveness guarantee rather than a tunable.
    expect(() =>
      buildRequest({ id: "r1", kind: "op", op: "kvfx.op.system.ping", budgetMs: MAX_BUDGET_MS + 1 }),
    ).toThrow(/Budget/);
  });

  it("refuses a non-positive or non-finite budget", () => {
    for (const budgetMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildRequest({ id: "r1", kind: "op", op: "kvfx.op.system.ping", budgetMs }),
      ).toThrow(/Budget/);
    }
  });

  it("refuses an undo group on a query", () => {
    expect(() =>
      buildRequest({ id: "r1", kind: "query", op: "kvfx.op.system.ping", undoGroup: "KVFX" }),
    ).toThrow(/must not open an undo group/);
  });

  it("carries an undo group on a plan", () => {
    const r = buildRequest({
      id: "r1",
      kind: "plan",
      op: "kvfx.op.system.ping",
      undoGroup: "KVFX Tools — Test",
    });
    expect(r.undoGroup).toBe("KVFX Tools — Test");
  });
});

describe("parseResponse", () => {
  const okReply = JSON.stringify({ v: PROTOCOL_VERSION, id: "r1", ok: true, result: { a: 1 }, elapsedMs: 3 });

  it("parses a success reply", () => {
    const r = parseResponse(okReply);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toEqual({ a: 1 });
  });

  it("parses an error reply", () => {
    const r = parseResponse(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: "r1",
        ok: false,
        error: { code: "target_not_found", message: "gone" },
        elapsedMs: 1,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("target_not_found");
  });

  it("reports a version mismatch with an actionable message", () => {
    const stale = JSON.stringify({ v: PROTOCOL_VERSION + 1, id: "r1", ok: true, result: null });
    expect(() => parseResponse(stale)).toThrow(/Reinstall/);
  });

  it("surfaces After Effects' raw evalScript failure as a transport error", () => {
    // An uncaught ExtendScript exception makes evalScript return this literal
    // string rather than anything JSON-shaped.
    expect(() => parseResponse("EvalScript error.")).toThrow(/non-JSON reply/);
  });

  it("rejects a truncated reply", () => {
    expect(() => parseResponse('{"v":1,"id":"r1"')).toThrow(/non-JSON reply/);
  });

  it("rejects a reply missing required fields", () => {
    expect(() => parseResponse(JSON.stringify({ v: PROTOCOL_VERSION, id: "r1" }))).toThrow(
      /missing required fields/,
    );
  });

  it("rejects a malformed error payload", () => {
    expect(() =>
      parseResponse(JSON.stringify({ v: PROTOCOL_VERSION, id: "r1", ok: false, error: "boom" })),
    ).toThrow(/malformed/);
  });
});
