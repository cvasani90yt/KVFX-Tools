/**
 * Stagger order: in what sequence a set of things starts moving.
 *
 * Used by Sequence (layers in time), UI Stagger (layers on screen) and the
 * text animator (characters, words or lines). Each item gets a *rank*; items
 * with the same rank start together, which is how centre-out sends the two
 * middle items of an even row off at once.
 *
 * The same rules are emitted as expression source for the text animator, so
 * the panel's preview, the plan and the composition all agree on the order.
 */

/* eslint-disable no-magic-numbers -- generator constants are the algorithm itself */

export type StaggerOrder = "forward" | "reverse" | "centre" | "edges" | "random";

export const STAGGER_ORDERS: readonly { readonly id: StaggerOrder; readonly label: string; readonly title: string }[] = [
  { id: "forward", label: "First → last", title: "In stack or reading order" },
  { id: "reverse", label: "Last → first", title: "From the end back to the start" },
  { id: "centre", label: "Centre → out", title: "The middle first, spreading to both ends" },
  { id: "edges", label: "Edges → in", title: "Both ends first, meeting in the middle" },
  { id: "random", label: "Random", title: "A shuffled order; change the seed for another" },
];

export function parseOrder(value: unknown, fallback: StaggerOrder = "forward"): StaggerOrder {
  return value === "forward" || value === "reverse" || value === "centre" || value === "edges" || value === "random"
    ? value
    : fallback;
}

/**
 * A seedable generator (Park–Miller). Chosen over faster ones because it needs
 * nothing but multiplication and modulo on numbers that stay exact in a
 * double, so the identical sequence can be written into an After Effects
 * expression on either engine — the preview and the composition agree.
 */
export function seededRandom(seed: number): () => number {
  let state = normaliseSeed(seed);
  return (): number => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function normaliseSeed(seed: number): number {
  const s = Math.abs(Math.floor(Number.isFinite(seed) ? seed : 1)) % 2147483647;
  return s === 0 ? 1 : s;
}

/** A seeded permutation of 0…count−1. */
export function seededPermutation(count: number, seed: number): number[] {
  const out = Array.from({ length: count }, (_, i) => i);
  const next = seededRandom(seed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i] as number;
    out[i] = out[j] as number;
    out[j] = a;
  }
  return out;
}

/** The rank of each item, in item order. Ranks start at 0. */
export function staggerRanks(count: number, order: StaggerOrder, seed = 1): number[] {
  const n = Math.max(0, Math.floor(count));
  const mid = (n - 1) / 2;
  switch (order) {
    case "reverse":
      return Array.from({ length: n }, (_, i) => n - 1 - i);
    case "centre":
      return Array.from({ length: n }, (_, i) => Math.floor(Math.abs(i - mid)));
    case "edges":
      return Array.from({ length: n }, (_, i) => Math.min(i, n - 1 - i));
    case "random": {
      const permutation = seededPermutation(n, seed);
      const ranks = new Array<number>(n).fill(0);
      permutation.forEach((item, rank) => {
        ranks[item] = rank;
      });
      return ranks;
    }
    default:
      return Array.from({ length: n }, (_, i) => i);
  }
}

/** The highest rank `staggerRanks` gives for this count and order. */
export function maxRank(count: number, order: StaggerOrder): number {
  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return 0;
  return order === "centre" || order === "edges" ? Math.floor((n - 1) / 2) : n - 1;
}

/**
 * Expression source for a function `kvRank(i, n)` (i 0-based) that returns the
 * same ranks as `staggerRanks`, so per-character timing in After Effects
 * follows the order the panel previewed. Random uses its own small generator
 * with the same seed, so it is stable from frame to frame.
 */
export function rankExpression(order: StaggerOrder, seed = 1): string {
  switch (order) {
    case "reverse":
      return "function kvRank(i, n) { return n - 1 - i; }\nfunction kvMaxRank(n) { return Math.max(0, n - 1); }";
    case "centre":
      return [
        "function kvRank(i, n) { return Math.floor(Math.abs(i - (n - 1) / 2)); }",
        "function kvMaxRank(n) { return n <= 1 ? 0 : Math.floor((n - 1) / 2); }",
      ].join("\n");
    case "edges":
      return [
        "function kvRank(i, n) { return Math.min(i, n - 1 - i); }",
        "function kvMaxRank(n) { return n <= 1 ? 0 : Math.floor((n - 1) / 2); }",
      ].join("\n");
    case "random":
      return [
        "function kvRank(i, n) {",
        `  var s = ${String(normaliseSeed(seed))}, p = [], k, j, t;`,
        "  for (k = 0; k < n; k++) p[k] = k;",
        "  for (k = n - 1; k > 0; k--) {",
        "    s = (s * 16807) % 2147483647;",
        "    j = Math.floor(((s - 1) / 2147483646) * (k + 1));",
        "    t = p[k]; p[k] = p[j]; p[j] = t;",
        "  }",
        "  for (k = 0; k < n; k++) if (p[k] === i) return k;",
        "  return i;",
        "}",
        "function kvMaxRank(n) { return Math.max(0, n - 1); }",
      ].join("\n");
    default:
      return "function kvRank(i, n) { return i; }\nfunction kvMaxRank(n) { return Math.max(0, n - 1); }";
  }
}
