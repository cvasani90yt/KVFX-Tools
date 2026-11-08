import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import { encodePowerShell, macCommand, windowsCommand, windowsPicker } from "../src/ops/screen-pick.js";
import type { HostJson } from "../src/runtime/serialize.js";
import { createMockAe, type MockAe } from "./mock-ae.js";

/**
 * color.screenPick — the system colour picker behind Pick from screen, where
 * the panel's browser eyedropper isn't available.
 */

interface Reply {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const MAC_OUT = "/Users/someone/Library/Application Support/KVFXTools/cache/screen-pick.txt";
const WIN_OUT = "C:\\Users\\someone\\AppData\\Roaming\\KVFXTools\\cache\\screen-pick.txt";

function query(ae: MockAe, args: Record<string, HostJson>): Reply {
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  return JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: "r1", kind: "query", op: "kvfx.op.color.screenPick", args, budgetMs: 1000 })) as Reply;
}

const decode = (command: string): string => Buffer.from(/-EncodedCommand (\S+)$/.exec(command)?.[1] ?? "", "base64").toString("utf16le");

describe("color.screenPick on Windows", () => {
  it("starts the click-to-pick picker detached, as an encoded command no script policy can block", () => {
    const ae = createMockAe({ os: "Windows/64 10.0" });
    const reply = query(ae, { out: WIN_OUT, rgb: [1, 0.5, 0] });
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ platform: "windows" });
    expect(ae.systemCalls).toHaveLength(1);
    const command = ae.systemCalls[0]!;
    expect(command.startsWith('cmd.exe /c start "" powershell.exe -NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ')).toBe(true);
    // The path is only inside the encoded script, never raw on the command line.
    expect(command).not.toContain("KVFXTools");
    const script = decode(command);
    expect(script).toContain(`$o='${WIN_OUT}'`);
    expect(script).toContain("CopyFromScreen");
    expect(script).toContain("GetPixel");
    expect(script).toContain("SetProcessDPIAware");
    expect(script).toContain("Move-Item -LiteralPath $p -Destination $o");
  });

  it("encodes UTF-16LE Base64 exactly as PowerShell reads it, accents included", () => {
    for (const text of ["", "a", "ab", "abc", "$o='C:\\Users\\Zoë'", windowsPicker(WIN_OUT)]) {
      expect(encodePowerShell(text)).toBe(Buffer.from(text, "utf16le").toString("base64"));
    }
  });

  it("doubles apostrophes in the path for PowerShell's quoting", () => {
    expect(windowsPicker("C:\\Users\\O'Brien\\AppData\\Roaming\\KVFXTools\\cache\\screen-pick.txt")).toContain("$o='C:\\Users\\O''Brien\\");
  });

  it("closes every quote and bracket it opens, even with an apostrophe in the path", () => {
    // No PowerShell here to parse it, so check the structure a typo would break.
    for (const out of [WIN_OUT, "C:\\Users\\O'Brien\\AppData\\Roaming\\KVFXTools\\cache\\screen-pick.txt"]) {
      const pairs: Record<string, string> = { ")": "(", "}": "{", "]": "[" };
      const open: string[] = [];
      let quote = false;
      const script = windowsPicker(out);
      for (let i = 0; i < script.length; i += 1) {
        const ch = script[i]!;
        if (quote) {
          if (ch === "'" && script[i + 1] === "'") i += 1;
          else if (ch === "'") quote = false;
        } else if (ch === "'") quote = true;
        else if ("({[".includes(ch)) open.push(ch);
        else if (ch in pairs) expect(open.pop(), `${ch} at ${i}`).toBe(pairs[ch]);
      }
      expect(quote).toBe(false);
      expect(open).toEqual([]);
    }
  });

  it("fits cmd.exe's command line, with room for a long user name", () => {
    expect(windowsCommand(`C:\\Users\\${"x".repeat(200)}\\AppData\\Roaming\\KVFXTools\\cache\\screen-pick.txt`).length).toBeLessThan(8191);
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
  });

  it("quotes an apostrophe in the path for the shell", () => {
    const out = "/Users/o'brien/Library/Application Support/KVFXTools/cache/screen-pick.txt";
    expect(macCommand(out, [1, 1, 1])).toContain("'/Users/o'\\''brien/Library/Application Support/KVFXTools/cache/screen-pick.txt'");
  });
});

describe("color.screenPick refuses", () => {
  it("any file but a .txt in KVFX's cache folder, and paths that would break their quoting", () => {
    for (const out of ["/Users/someone/Desktop/x.txt", "/x/KVFXTools/cache/x.png", "/x/KVFXTools/cache/sub/x.txt", "/x/KVFXTools/cache/a\nb.txt", "", 7]) {
      const ae = createMockAe({ os: "Macintosh OS 14" });
      expect(query(ae, { out }).error?.code, JSON.stringify(out)).toBe("invalid_argument");
      expect(ae.systemCalls).toEqual([]);
    }
  });

  it("says how to allow it when After Effects won't run system commands", () => {
    const ae = createMockAe({ os: "Windows/64 10.0" });
    (ae as unknown as { callSystem: () => string }).callSystem = () => {
      throw new Error("not allowed");
    };
    const reply = query(ae, { out: WIN_OUT });
    expect(reply.error?.code).toBe("precondition_failed");
    expect(reply.error?.message).toContain("Allow Scripts to Write Files and Access Network");
  });
});
