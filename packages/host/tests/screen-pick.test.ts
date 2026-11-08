import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import { macCommand } from "../src/ops/screen-pick.js";
import type { HostJson } from "../src/runtime/serialize.js";
import { createMockAe, type MockAe } from "./mock-ae.js";

/**
 * color.screenPick — the host's fallback for starting the system colour
 * picker, used only when the panel can't start it itself. It must return at
 * once: After Effects is frozen while a script runs.
 */

interface Reply {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const MAC_OUT = "/Users/someone/Library/Application Support/KVFXTools/cache/screen-pick.txt";
const WIN_LAUNCHER = "C:/Users/someone/AppData/Roaming/KVFXTools/cache/screen-pick.cmd";

function query(ae: MockAe, args: Record<string, HostJson>): Reply {
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  return JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: "r1", kind: "query", op: "kvfx.op.color.screenPick", args, budgetMs: 1000 })) as Reply;
}

describe("color.screenPick on Windows", () => {
  it("opens the panel's launcher as a double-click would, and never runs a command After Effects would wait on", () => {
    const ae = createMockAe({ os: "Windows/64 10.0" });
    const reply = query(ae, { launcher: WIN_LAUNCHER });
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ platform: "windows" });
    expect(ae.executedFiles).toEqual([WIN_LAUNCHER]);
    expect(ae.systemCalls).toEqual([]);
  });

  it("takes the launcher with either kind of slash", () => {
    const ae = createMockAe({ os: "Windows/64 10.0" });
    const path = "C:\\Users\\someone\\AppData\\Roaming\\KVFXTools\\cache\\screen-pick.cmd";
    expect(query(ae, { launcher: path }).ok).toBe(true);
    expect(ae.executedFiles).toEqual([path]);
  });

  it("opens nothing but screen-pick.cmd in KVFX's cache folder", () => {
    for (const launcher of [
      "C:/Users/someone/Desktop/screen-pick.cmd",
      "C:/x/KVFXTools/cache/other.cmd",
      "C:/x/KVFXTools/cache/screen-pick.bat",
      "C:/x/KVFXTools/cache/screen-pick.exe",
      "C:/x/KVFXTools/cache/sub/screen-pick.cmd",
      "C:/x/KVFXTools/cache/screen-pick.cmd\nx",
      "",
      7,
    ]) {
      const ae = createMockAe({ os: "Windows/64 10.0" });
      expect(query(ae, { launcher }).error?.code, JSON.stringify(launcher)).toBe("invalid_argument");
      expect(ae.executedFiles).toEqual([]);
    }
    // The macOS form of the request is refused on Windows too: no command line.
    const ae = createMockAe({ os: "Windows/64 10.0" });
    expect(query(ae, { out: "C:/x/KVFXTools/cache/screen-pick.txt" }).error?.code).toBe("invalid_argument");
    expect(ae.systemCalls).toEqual([]);
  });

  it("says so when Windows won't open it, and how to allow it when After Effects won't", () => {
    const refused = createMockAe({ os: "Windows/64 10.0" });
    (refused as unknown as { executeFile: () => boolean }).executeFile = () => false;
    expect(query(refused, { launcher: WIN_LAUNCHER }).error?.message).toBe("Windows couldn't start the screen picker. Use From comp instead.");

    const blocked = createMockAe({ os: "Windows/64 10.0" });
    (blocked as unknown as { executeFile: () => boolean }).executeFile = () => {
      throw new Error("not allowed");
    };
    const reply = query(blocked, { launcher: WIN_LAUNCHER });
    expect(reply.error?.code).toBe("precondition_failed");
    expect(reply.error?.message).toContain("Allow Scripts to Write Files and Access Network");
  });
});

describe("color.screenPick on macOS", () => {
  it("opens the system colour panel in the background, starting on the panel's colour", () => {
    const ae = createMockAe({ os: "Macintosh OS 14.5/64" });
    const reply = query(ae, { out: MAC_OUT, rgb: [1, 0.5607843, 0.2470588] });
    expect(reply.result).toEqual({ platform: "mac" });
    const command = ae.systemCalls[0]!;
    expect(command).toContain("osascript -e 'activate' -e 'choose color default color {65535, 36751, 16191}'");
    expect(command).toContain(`> '${MAC_OUT}.part' 2>&1 ; mv -f '${MAC_OUT}.part' '${MAC_OUT}'`);
    // Detached, so After Effects isn't held while the user picks.
    expect(command.endsWith(" ) > /dev/null 2>&1 &")).toBe(true);
    expect(ae.executedFiles).toEqual([]);
  });

  it("quotes an apostrophe in the path for the shell", () => {
    const out = "/Users/o'brien/Library/Application Support/KVFXTools/cache/screen-pick.txt";
    expect(macCommand(out, [1, 1, 1])).toContain("'/Users/o'\\''brien/Library/Application Support/KVFXTools/cache/screen-pick.txt'");
  });

  it("refuses any file but a .txt in KVFX's cache folder, and paths that would break their quoting", () => {
    for (const out of ["/Users/someone/Desktop/x.txt", "/x/KVFXTools/cache/x.png", "/x/KVFXTools/cache/sub/x.txt", "/x/KVFXTools/cache/a\nb.txt", "", 7]) {
      const ae = createMockAe({ os: "Macintosh OS 14" });
      expect(query(ae, { out }).error?.code, JSON.stringify(out)).toBe("invalid_argument");
      expect(ae.systemCalls).toEqual([]);
    }
  });

  it("says how to allow it when After Effects won't run system commands", () => {
    const ae = createMockAe({ os: "Macintosh OS 14" });
    (ae as unknown as { callSystem: () => string }).callSystem = () => {
      throw new Error("not allowed");
    };
    const reply = query(ae, { out: MAC_OUT });
    expect(reply.error?.code).toBe("precondition_failed");
    expect(reply.error?.message).toContain("Allow Scripts to Write Files and Access Network");
  });
});
