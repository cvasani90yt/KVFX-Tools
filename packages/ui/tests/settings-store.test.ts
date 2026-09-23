import { describe, expect, it } from "vitest";
import { CepSettingsStore, systemPathToNative } from "../src/app/cep/settings-store.js";
import type { AdobeCepFs } from "../src/app/cep/types.js";

/**
 * Path conversion is the classic cross-platform defect: it works perfectly on
 * the machine it was written on. CEP hands back `file:///C:/Users/...` on
 * Windows and `file:///Users/...` on macOS, so stripping a fixed prefix breaks
 * exactly one of the two — and whichever one you do not have.
 */
describe("systemPathToNative", () => {
  it("converts a Windows user-data URL", () => {
    expect(systemPathToNative("file:///C:/Users/someone/AppData/Roaming")).toBe(
      "C:/Users/someone/AppData/Roaming",
    );
  });

  it("converts a macOS user-data URL", () => {
    expect(systemPathToNative("file:///Users/someone/Library/Application Support")).toBe(
      "/Users/someone/Library/Application Support",
    );
  });

  it("keeps the leading slash on a POSIX path and drops it before a drive letter", () => {
    expect(systemPathToNative("file:///var/folders/x")).toBe("/var/folders/x");
    expect(systemPathToNative("file:///D:/data")).toBe("D:/data");
  });

  it("decodes percent-escapes, which appear in real user names", () => {
    expect(systemPathToNative("file:///Users/some%20one/Library")).toBe("/Users/some one/Library");
  });

  it("passes through a path that is already native", () => {
    expect(systemPathToNative("/Users/someone")).toBe("/Users/someone");
  });
});

interface Recorded {
  readonly writes: { path: string; data: string }[];
  readonly dirs: string[];
}

function fakeFs(
  overrides: { readFile?: AdobeCepFs["readFile"]; writeErr?: number } = {},
): { fs: AdobeCepFs; recorded: Recorded } {
  const recorded: Recorded = { writes: [], dirs: [] };
  const fs: AdobeCepFs = {
    readFile: overrides.readFile ?? ((): { err: number } => ({ err: 3 })),
    writeFile: (path, data) => {
      recorded.writes.push({ path, data });
      return { err: overrides.writeErr ?? 0 };
    },
    makedir: (path) => {
      recorded.dirs.push(path);
      return { err: 0 };
    },
  };
  return { fs, recorded };
}

describe("CepSettingsStore", () => {
  it("writes inside our own folder under the platform data root", () => {
    const { fs, recorded } = fakeFs();
    const store = new CepSettingsStore(fs, "/Users/someone/Library/Application Support");

    store.write({ schemaVersion: 1 });

    expect(store.location()).toBe(
      "/Users/someone/Library/Application Support/KVFXTools/config/settings.json",
    );
    expect(recorded.writes[0]?.path).toBe(store.location());
  });

  it("creates each directory level, because makedir is not recursive", () => {
    const { fs, recorded } = fakeFs();
    new CepSettingsStore(fs, "/root").write({});
    expect(recorded.dirs).toEqual(["/root/KVFXTools", "/root/KVFXTools/config"]);
  });

  it("writes readable JSON, so a user can inspect or repair it", () => {
    const { fs, recorded } = fakeFs();
    new CepSettingsStore(fs, "/root").write({ favourites: ["a"] });
    expect(recorded.writes[0]?.data).toContain("\n");
    expect(JSON.parse(recorded.writes[0]?.data ?? "")).toEqual({ favourites: ["a"] });
  });

  it("treats a read error as 'no settings yet'", () => {
    // A missing file is the common first-run case, and every other read failure
    // should also fall back to defaults rather than break the panel.
    const { fs } = fakeFs({ readFile: () => ({ err: 3 }) });
    expect(new CepSettingsStore(fs, "/root").read()).toBeUndefined();
  });

  it("treats malformed JSON as 'no settings yet' rather than throwing", () => {
    const { fs } = fakeFs({ readFile: () => ({ err: 0, data: "{ truncated" }) });
    expect(new CepSettingsStore(fs, "/root").read()).toBeUndefined();
  });

  it("reads back well-formed settings", () => {
    const { fs } = fakeFs({ readFile: () => ({ err: 0, data: '{"favourites":["a"]}' }) });
    expect(new CepSettingsStore(fs, "/root").read()).toEqual({ favourites: ["a"] });
  });

  it("reports a write failure instead of claiming success", () => {
    const { fs } = fakeFs({ writeErr: 6 });
    const result = new CepSettingsStore(fs, "/root").write({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Could not write/);
  });
});
