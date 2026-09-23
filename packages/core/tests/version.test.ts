import { describe, expect, it } from "vitest";
import {
  compareAeVersions,
  formatAeVersion,
  parseAeVersion,
  satisfiesMinimum,
} from "../src/util/version.js";

describe("parseAeVersion", () => {
  it("parses a full version", () => {
    expect(parseAeVersion("26.0.1")).toEqual({ major: 26, minor: 0, patch: 1 });
  });

  it("defaults omitted components to zero", () => {
    expect(parseAeVersion("26")).toEqual({ major: 26, minor: 0, patch: 0 });
    expect(parseAeVersion("26.3")).toEqual({ major: 26, minor: 3, patch: 0 });
  });

  it("ignores the build suffix After Effects appends", () => {
    expect(parseAeVersion("26.0.1x45")).toEqual({ major: 26, minor: 0, patch: 1 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseAeVersion("  24.5  ")).toEqual({ major: 24, minor: 5, patch: 0 });
  });

  it("rejects non-numeric input", () => {
    expect(parseAeVersion("")).toBeUndefined();
    expect(parseAeVersion("beta")).toBeUndefined();
    expect(parseAeVersion("v26.0")).toBeUndefined();
  });
});

describe("compareAeVersions", () => {
  it("orders by major, then minor, then patch", () => {
    const lt = (a: string, b: string): boolean =>
      compareAeVersions(parseAeVersion(a)!, parseAeVersion(b)!) < 0;

    expect(lt("24.0.0", "26.0.0")).toBe(true);
    expect(lt("26.0.0", "26.1.0")).toBe(true);
    expect(lt("26.1.0", "26.1.1")).toBe(true);
  });

  it("treats equal versions as equal", () => {
    expect(compareAeVersions(parseAeVersion("26.0.0")!, parseAeVersion("26")!)).toBe(0);
  });

  it("does not compare components lexically", () => {
    // "9" > "10" as strings; the comparison must be numeric.
    expect(compareAeVersions(parseAeVersion("26.10")!, parseAeVersion("26.9")!)).toBeGreaterThan(0);
  });
});

describe("satisfiesMinimum", () => {
  it("accepts equal and newer hosts", () => {
    expect(satisfiesMinimum("22.0", "22.0")).toBe(true);
    expect(satisfiesMinimum("26.0.1x45", "22.0")).toBe(true);
  });

  it("rejects older hosts", () => {
    expect(satisfiesMinimum("21.5", "22.0")).toBe(false);
  });

  it("fails closed on unparseable input", () => {
    // We must never assume an API exists on a host we could not identify.
    expect(satisfiesMinimum("unknown", "22.0")).toBe(false);
    expect(satisfiesMinimum("26.0", "unknown")).toBe(false);
  });
});

describe("formatAeVersion", () => {
  it("round-trips through the parser", () => {
    expect(formatAeVersion(parseAeVersion("26.0.1x45")!)).toBe("26.0.1");
  });
});
