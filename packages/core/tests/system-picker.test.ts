import { describe, expect, it } from "vitest";
import {
  SYSTEM_PICKER_TIMEOUT_MS,
  encodePowerShell,
  macPickerScript,
  powershellCandidates,
  windowsPickerArgs,
  windowsPickerLauncher,
  windowsPickerScript,
} from "../src/index.js";

/**
 * The system colour pickers behind Pick from screen inside After Effects.
 * There is no PowerShell or macOS here to run them, so these pin what a typo
 * or a quoting slip would break.
 */

const WIN_OUT = "C:/Users/someone/AppData/Roaming/KVFXTools/cache/screen-pick.txt";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 back to UTF-16LE text, written independently of the encoder under test. */
function decode(base64: string): string {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const ch of base64.replace(/=+$/, "")) {
    value = ((value << 6) | ALPHABET.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  let text = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8));
  return text;
}

describe("the Windows picker", () => {
  it("encodes UTF-16LE Base64 exactly as PowerShell reads it, accents included", () => {
    // Worked by hand from the UTF-16LE bytes: "a" is 61 00, "ë" is EB 00.
    expect(["", "a", "ab", "abc", "Zoë"].map(encodePowerShell)).toEqual(["", "YQA=", "YQBiAA==", "YQBiAGMA", "WgBvAOsA"]);
    for (const text of ["$o='C:\\Users\\Zoë'", windowsPickerScript(WIN_OUT)]) expect(decode(encodePowerShell(text))).toBe(text);
  });

  it("freezes the screens into a topmost window and writes the answer whole", () => {
    const script = windowsPickerScript(WIN_OUT);
    expect(script).toContain(`$o='${WIN_OUT}'`);
    expect(script).toContain("CopyFromScreen");
    expect(script).toContain("GetPixel");
    expect(script).toContain("$f.TopMost=$true");
    expect(script).toContain("[IO.File]::WriteAllText($p,$global:r);Move-Item -LiteralPath $p -Destination $o -Force");
  });

  it("keeps going without DPI awareness, rather than failing on it", () => {
    const script = windowsPickerScript(WIN_OUT);
    expect(script).toMatch(/try\{Add-Type -Namespace KvfxPick[^\n]*SetProcessDPIAware\(\)\}catch\{\}/);
  });

  it("shows a throwaway window first, so a 'start hidden' request can't hide the picker", () => {
    const script = windowsPickerScript(WIN_OUT);
    const throwaway = script.indexOf("$d.Show();$d.Close()");
    expect(throwaway).toBeGreaterThan(script.indexOf("SetProcessDPIAware"));
    expect(throwaway).toBeLessThan(script.indexOf("$f.ShowDialog()"));
    expect(script).toContain("$d.Opacity=0");
  });

  it("closes itself if nobody picks, and comes to the front when shown", () => {
    const script = windowsPickerScript(WIN_OUT);
    expect(script).toContain(`$t.Interval=${String(SYSTEM_PICKER_TIMEOUT_MS)}`);
    expect(script).toContain("$f.Add_Shown({$global:f.Activate();[void]$global:f.Focus()})");
  });

  it("doubles apostrophes in the path for PowerShell's quoting", () => {
    expect(windowsPickerScript("C:/Users/O'Brien/AppData/Roaming/KVFXTools/cache/screen-pick.txt")).toContain("$o='C:/Users/O''Brien/");
  });

  it("closes every quote and bracket it opens, even with an apostrophe in the path", () => {
    for (const out of [WIN_OUT, "C:/Users/O'Brien/AppData/Roaming/KVFXTools/cache/screen-pick.txt"]) {
      const pairs: Record<string, string> = { ")": "(", "}": "{", "]": "[" };
      const open: string[] = [];
      let quote = false;
      const script = windowsPickerScript(out);
      for (let i = 0; i < script.length; i += 1) {
        const ch = script[i]!;
        if (quote) {
          if (ch === "'" && script[i + 1] === "'") i += 1;
          else if (ch === "'") quote = false;
        } else if (ch === "'") quote = true;
        else if ("({[".includes(ch)) open.push(ch);
        else if (ch in pairs) expect(open.pop(), `${ch} at ${String(i)}`).toBe(pairs[ch]);
      }
      expect(quote).toBe(false);
      expect(open).toEqual([]);
    }
  });

  it("passes powershell.exe arguments with no space or quote in any of them", () => {
    const args = windowsPickerArgs(WIN_OUT);
    expect(args.slice(0, -1)).toEqual(["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand"]);
    for (const arg of args) expect(arg, arg.slice(0, 20)).toMatch(/^[^\s"']+$/);
    expect(decode(args[args.length - 1]!)).toBe(windowsPickerScript(WIN_OUT));
  });

  it("writes a launcher that starts the picker and exits, within cmd.exe's line length", () => {
    const launcher = windowsPickerLauncher(POWERSHELL, WIN_OUT);
    expect(launcher.startsWith(`@start "" "${POWERSHELL}" -NoProfile `)).toBe(true);
    expect(launcher.endsWith("\r\n")).toBe(true);
    expect(launcher.trim().split("\n")).toHaveLength(1);
    // A % would be read as a variable by cmd.exe.
    expect(launcher).not.toContain("%");
    const long = windowsPickerLauncher(POWERSHELL, `C:/Users/${"x".repeat(200)}/AppData/Roaming/KVFXTools/cache/screen-pick.txt`);
    expect(long.length).toBeLessThan(8191);
  });

  it("looks for powershell.exe under Windows on the user's drive, then on C:", () => {
    expect(powershellCandidates("C:/Users/someone/AppData/Roaming/KVFXTools")).toEqual([POWERSHELL]);
    expect(powershellCandidates("d:\\Users\\someone\\AppData\\Roaming")).toEqual([
      "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      POWERSHELL,
    ]);
    expect(powershellCandidates("/preview/KVFXTools")).toEqual([POWERSHELL]);
  });
});

describe("the macOS picker", () => {
  it("opens the colour panel on the panel's colour and moves the answer into place whole", () => {
    const out = "/Users/someone/Library/Application Support/KVFXTools/cache/screen-pick.txt";
    expect(macPickerScript(out, [1, 0.5607843, 0.2470588])).toBe(
      `/usr/bin/osascript -e 'activate' -e 'choose color default color {65535, 36751, 16191}' > '${out}.part' 2>&1; /bin/mv -f '${out}.part' '${out}'`,
    );
  });

  it("quotes an apostrophe in the path for the shell, and keeps channels in range", () => {
    const script = macPickerScript("/Users/o'brien/KVFXTools/cache/screen-pick.txt", [2, -1, Number.NaN]);
    expect(script).toContain("'/Users/o'\\''brien/KVFXTools/cache/screen-pick.txt'");
    expect(script).toContain("{65535, 0, ");
  });
});
