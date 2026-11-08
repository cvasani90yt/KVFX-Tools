import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import type { HostJson } from "../src/runtime/serialize.js";
import { createMockAe, type MockAe } from "./mock-ae.js";

/**
 * comp.frame — the Pick from comp eyedropper's frame grab.
 */

interface Reply {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const CACHE = "/Users/someone/Library/Application Support/KVFXTools/cache/comp-frame.png";

function query(ae: MockAe, args: Record<string, HostJson>): Reply {
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  return JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: "r1", kind: "query", op: "kvfx.op.comp.frame", args, budgetMs: 1000 })) as Reply;
}

function comp(): MockAe {
  const ae = createMockAe({ comp: { width: 1280, height: 720, frameRate: 25, layers: [{ name: "Shot" }] } });
  ae.comp!.time = 2.4;
  ae.comp!.bgColor = [0.1, 0.2, 0.3];
  return ae;
}

describe("comp.frame", () => {
  it("saves the frame at the playhead to the cache file and describes it", () => {
    const ae = comp();
    const reply = query(ae, { path: CACHE });
    expect(reply.ok).toBe(true);
    expect(ae.comp!.savedFrames).toEqual([{ time: 2.4, path: CACHE }]);
    expect(reply.result).toEqual({ path: CACHE, width: 1280, height: 720, time: 2.4, background: [0.1, 0.2, 0.3], bitsPerChannel: 8 });
  });

  it("works with Windows paths too", () => {
    const ae = comp();
    const path = "C:\\Users\\someone\\AppData\\Roaming\\KVFXTools\\cache\\comp-frame.png";
    expect(query(ae, { path }).ok).toBe(true);
    expect(ae.comp!.savedFrames[0]!.path).toBe(path);
  });

  it("reports a 32-bit project, where the saved frame can come out dark", () => {
    const ae = comp();
    (ae.app.project as unknown as { bitsPerChannel: number }).bitsPerChannel = 32;
    expect(query(ae, { path: CACHE }).result?.["bitsPerChannel"]).toBe(32);
  });

  it("writes nowhere but KVFX's cache folder, and only PNGs", () => {
    for (const path of ["/Users/someone/Desktop/frame.png", "/tmp/KVFXTools/cache/frame.jpg", "/x/KVFXTools/cache/sub/frame.png", "", 4]) {
      const ae = comp();
      const reply = query(ae, { path });
      expect(reply.error?.code, String(path)).toBe("invalid_argument");
      expect(ae.comp!.savedFrames).toEqual([]);
    }
  });

  it("runs as a plan step, which a heavy frame needs for its longer time limit", () => {
    const ae = comp();
    const dispatch = createDispatcher(createProductionRegistry(), ae);
    const reply = JSON.parse(
      dispatch({
        v: PROTOCOL_VERSION,
        id: "p1",
        kind: "plan",
        op: "kvfx.op.core.plan",
        args: { steps: [{ op: "kvfx.op.comp.frame", args: { path: CACHE } }] },
        undoGroup: "KVFX Tools — Pick from comp",
        budgetMs: 30_000,
      }),
    ) as { ok: boolean; result?: { steps: { result: Record<string, unknown> }[] } };
    expect(reply.ok).toBe(true);
    expect(reply.result?.steps[0]?.result["path"]).toBe(CACHE);
    expect(ae.comp!.savedFrames).toHaveLength(1);
  });

  it("says so when no comp is open, or After Effects can't save frames", () => {
    expect(query(createMockAe({}), { path: CACHE }).error?.code).toBe("precondition_failed");
    const ae = comp();
    (ae.comp as unknown as { saveFrameToPng?: unknown }).saveFrameToPng = undefined;
    expect(query(ae, { path: CACHE }).error?.code).toBe("unsupported_host_version");
  });
});
