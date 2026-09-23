import { describe, expect, it } from "vitest";
import { fuzzyMatch, wordStarts } from "../src/search/fuzzy.js";

/**
 * These tests assert *ordering*, not absolute scores.
 *
 * Absolute numbers are an implementation detail and pinning them makes the
 * suite fight every tuning change. What must never regress is which result the
 * user sees first.
 */

function score(query: string, target: string): number {
  const match = fuzzyMatch(query, target);
  if (match === undefined) throw new Error(`"${query}" did not match "${target}"`);
  return match.score;
}

function ranksAbove(query: string, winner: string, loser: string): boolean {
  return score(query, winner) > score(query, loser);
}

describe("wordStarts", () => {
  it("finds the start of each word", () => {
    expect(wordStarts("Move to Top")).toEqual([0, 5, 8]);
  });

  it("treats separators as boundaries", () => {
    expect(wordStarts("create-null")).toEqual([0, 7]);
    expect(wordStarts("create_null")).toEqual([0, 7]);
    expect(wordStarts("kvfx.op.layer")).toEqual([0, 5, 8]);
  });

  it("treats a camelCase hump as a boundary", () => {
    // So "sf" matches the acronym of "setFlag".
    expect(wordStarts("setFlag")).toEqual([0, 3]);
  });

  it("does not report a separator as a word start", () => {
    expect(wordStarts(" leading")).toEqual([1]);
  });
});

describe("fuzzyMatch — tiers", () => {
  it("ranks an exact match above everything", () => {
    expect(ranksAbove("solo", "solo", "Solo Layer")).toBe(true);
  });

  it("ranks a prefix above a word prefix", () => {
    expect(ranksAbove("create", "Create Null", "Quickly Create")).toBe(true);
  });

  it("ranks a word prefix above an acronym", () => {
    expect(ranksAbove("top", "Move to Top", "Toggle Opacity Path")).toBe(true);
  });

  it("ranks an acronym above a scattered subsequence", () => {
    expect(ranksAbove("mtt", "Move to Top", "Mask Tint Matte")).toBe(true);
  });

  it("ranks a substring above a scattered subsequence", () => {
    expect(ranksAbove("null", "Create Null", "Numeric Layer Label")).toBe(true);
  });

  it("prefers an earlier match within the same tier", () => {
    // Both are mid-word substrings, so only position separates them.
    expect(ranksAbove("lock", "Unlock", "Overlock")).toBe(true);
  });

  it("prefers a word prefix over an earlier mid-word substring", () => {
    // Intentional: "lock" at the start of a word is what the user meant, even
    // though "Unlock" contains the substring sooner.
    expect(ranksAbove("lock", "Really Long Name With lock Late", "Unlock")).toBe(true);
  });

  it("prefers a shorter target when tiers and positions are equal", () => {
    expect(ranksAbove("create", "Create Null", "Create Adjustment Layer")).toBe(true);
  });
});

describe("fuzzyMatch — matching", () => {
  it("is case-insensitive", () => {
    expect(fuzzyMatch("SOLO", "solo")?.score).toBe(fuzzyMatch("solo", "SOLO")?.score);
  });

  it("matches an acronym across words", () => {
    expect(fuzzyMatch("mtb", "Move to Bottom")).toBeDefined();
    expect(fuzzyMatch("can", "Create Adjustment Null")).toBeDefined();
  });

  it("matches a scattered subsequence in order", () => {
    expect(fuzzyMatch("crnl", "Create Null")).toBeDefined();
  });

  it("rejects characters that are out of order", () => {
    expect(fuzzyMatch("lnuc", "Create Null")).toBeUndefined();
  });

  it("rejects a query with characters the target lacks", () => {
    expect(fuzzyMatch("zzz", "Create Null")).toBeUndefined();
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("does not match an empty target", () => {
    expect(fuzzyMatch("a", "")).toBeUndefined();
  });
});

describe("fuzzyMatch — highlight positions", () => {
  it("reports the matched prefix", () => {
    expect(fuzzyMatch("crea", "Create Null")?.positions).toEqual([0, 1, 2, 3]);
  });

  it("reports the whole target on an exact match", () => {
    expect(fuzzyMatch("solo", "solo")?.positions).toEqual([0, 1, 2, 3]);
  });

  it("reports the word-prefix offset", () => {
    expect(fuzzyMatch("top", "Move to Top")?.positions).toEqual([8, 9, 10]);
  });

  it("reports word starts for an acronym", () => {
    expect(fuzzyMatch("mtt", "Move to Top")?.positions).toEqual([0, 5, 8]);
  });

  it("reports scattered positions in order", () => {
    const positions = fuzzyMatch("crnl", "Create Null")?.positions ?? [];
    expect(positions).toHaveLength(4);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] as number);
    }
  });

  it("only reports positions that actually hold the query characters", () => {
    const target = "Create Adjustment Layer";
    const positions = fuzzyMatch("cal", target)?.positions ?? [];
    const matched = positions.map((i) => target.charAt(i).toLowerCase()).join("");
    expect(matched).toBe("cal");
  });
});
