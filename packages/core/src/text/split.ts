/**
 * Character ranges for the text exploder.
 *
 * Ranges are half-open [start, end) in characters, the way a range selector
 * set to Index units counts them: every character, spaces and line breaks
 * included. Characters are counted by code point so an emoji or other
 * astral-plane character is one character, not two UTF-16 halves.
 */

export type SplitMode = "characters" | "words" | "lines";

export interface TextRange {
  readonly start: number;
  readonly end: number;
  /** The piece's own text, used as its layer name. */
  readonly name: string;
}

const MAX_NAME = 32;

function isBreak(ch: string): boolean {
  // After Effects stores line breaks as carriage returns; ETX appears for
  // soft returns in some builds.
  return ch === "\r" || ch === "\n" || ch === "\u0003";
}

function isSpace(ch: string): boolean {
  return isBreak(ch) || /\s/.test(ch);
}

function nameOf(piece: string): string {
  const flat = piece.replace(/\s+/g, " ").trim();
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME - 1)}…` : flat;
}

export function splitRanges(text: string, mode: SplitMode): TextRange[] {
  const chars = Array.from(text);
  const ranges: TextRange[] = [];

  if (mode === "characters") {
    chars.forEach((ch, i) => {
      if (!isSpace(ch)) ranges.push({ start: i, end: i + 1, name: ch });
    });
    return ranges;
  }

  const boundary = mode === "words" ? isSpace : isBreak;
  let start = -1;
  for (let i = 0; i <= chars.length; i += 1) {
    const ch = chars[i];
    const atBoundary = ch === undefined || boundary(ch);
    if (!atBoundary && start === -1) start = i;
    if (atBoundary && start !== -1) {
      const piece = chars.slice(start, i).join("");
      // A line of nothing but spaces is not worth a layer.
      if (piece.trim().length > 0) ranges.push({ start, end: i, name: nameOf(piece) });
      start = -1;
    }
  }
  return ranges;
}
