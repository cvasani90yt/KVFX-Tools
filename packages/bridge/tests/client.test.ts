import { describe, expect, it, vi } from "vitest";
import { HOST_GLOBAL, HostClient } from "../src/host/client.js";
import { PROTOCOL_VERSION } from "../src/protocol/envelope.js";
import type { HostTransport } from "../src/host/transport.js";

function replyingTransport(build: (source: string) => unknown): HostTransport {
  return { evaluate: (source) => Promise.resolve(JSON.stringify(build(source))) };
}

function idOf(source: string): string {
  const match = /"id":"([^"]+)"/.exec(source);
  return match?.[1] ?? "";
}

describe("HostClient", () => {
  it("builds a dispatch call carrying the request literal", () => {
    const client = new HostClient({ transport: replyingTransport(() => null), nextId: () => "r1" });
    const source = client.buildSource({ kind: "query", op: "kvfx.op.system.ping" });

    expect(source.startsWith(`${HOST_GLOBAL}.dispatch({`)).toBe(true);
    expect(source.endsWith("})")).toBe(true);
    expect(source).toContain('"op":"kvfx.op.system.ping"');
  });

  it("resolves a success reply", async () => {
    const client = new HostClient({
      transport: replyingTransport((s) => ({
        v: PROTOCOL_VERSION,
        id: idOf(s),
        ok: true,
        result: { pong: true },
        elapsedMs: 2,
      })),
    });

    const r = await client.send({ kind: "query", op: "kvfx.op.system.ping" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ pong: true });
  });

  it("returns a structured error instead of throwing on host failure", async () => {
    const client = new HostClient({
      transport: replyingTransport((s) => ({
        v: PROTOCOL_VERSION,
        id: idOf(s),
        ok: false,
        error: { code: "precondition_failed", message: "no comp" },
        elapsedMs: 1,
      })),
    });

    const r = await client.send({ kind: "query", op: "kvfx.op.system.ping" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("precondition_failed");
  });

  it("rejects a reply whose id does not match the request", async () => {
    const client = new HostClient({
      transport: replyingTransport(() => ({
        v: PROTOCOL_VERSION,
        id: "someone-elses-id",
        ok: true,
        result: null,
        elapsedMs: 1,
      })),
    });

    const r = await client.send({ kind: "query", op: "kvfx.op.system.ping" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("transport_failure");
  });

  it("fails closed when the request cannot be built", async () => {
    const evaluate = vi.fn<HostTransport["evaluate"]>();
    const client = new HostClient({ transport: { evaluate } });

    const r = await client.send({ kind: "op", op: "not-an-op-id" });

    expect(r.ok).toBe(false);
    // Nothing must reach After Effects if we could not build a valid request.
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("times out rather than hanging when the host never replies", async () => {
    vi.useFakeTimers();
    try {
      const client = new HostClient({ transport: { evaluate: () => new Promise<string>(() => {}) } });
      const pending = client.send({ kind: "query", op: "kvfx.op.system.ping", budgetMs: 100 });

      await vi.advanceTimersByTimeAsync(100 + 4000 + 1);
      const r = await pending;

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("budget_exceeded");
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a transport rejection as a structured error", async () => {
    const client = new HostClient({
      transport: { evaluate: () => Promise.reject(new Error("panel detached")) },
    });

    const r = await client.send({ kind: "query", op: "kvfx.op.system.ping" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("panel detached");
  });

  it("issues distinct ids for successive requests", () => {
    const client = new HostClient({ transport: replyingTransport(() => null) });
    const a = idOf(client.buildSource({ kind: "query", op: "kvfx.op.system.ping" }));
    const b = idOf(client.buildSource({ kind: "query", op: "kvfx.op.system.ping" }));
    expect(a).not.toBe(b);
  });
});
