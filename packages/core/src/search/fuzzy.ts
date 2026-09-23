/**
 * Fuzzy matching for the command palette.
 *
 * Ranking is tiered rather than a single heuristic, because the tiers are what
 * make results feel predictable: an exact prefix must always beat an acronym,
 * which must always beat a scattered subsequence, no matter how the bonuses
 * fall out. A palette that reorders unpredictably as you type is worse than no
 * palette, since the user stops trusting the first result and starts reading
 * the whole list.
 *
 * Pure and deterministic, so `tests/fuzzy.test.ts` can pin the ordering and
 * ranking cannot silently regress.
 */

export interface FuzzyMatch {
  readonly score: number;
  /** Indices in the target that matched, for highlighting. */
  readonly positions: readonly number[];
}

/** Tier floors. The gaps are wide enough that bonuses never cross a tier. */
const SCORE_EXACT = 10_000;
const SCORE_PREFIX = 8_000;
const SCORE_WORD_PREFIX = 6_000;
const SCORE_ACRONYM = 4_000;
const SCORE_SUBSTRING = 2_000;
const SCORE_SUBSEQUENCE = 500;

/** Within a tier: earlier matches and shorter targets win. */
const POSITION_PENALTY = 4;
const LENGTH_PENALTY = 0.5;

/** Subsequence bonuses. */
const WORD_START_BONUS = 15;
const CONSECUTIVE_BONUS = 10;
const GAP_PENALTY = 1;

const WORD_SEPARATORS = " \t-_./()[]";

/** Indices at which a new word begins, computed from the original casing. */
export function wordStarts(target: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < target.length; i += 1) {
    const char = target.charAt(i);
    if (i === 0) {
      if (WORD_SEPARATORS.indexOf(char) === -1) starts.push(i);
      continue;
    }
    const previous = target.charAt(i - 1);
    const afterSeparator = WORD_SEPARATORS.indexOf(previous) !== -1;
    // A camelCase or PascalCase hump also starts a word, so "setFlag" matches
    // the acronym "sf".
    const camelHump = previous !== previous.toUpperCase() && char === char.toUpperCase() && char !== char.toLowerCase();
    if ((afterSeparator || camelHump) && WORD_SEPARATORS.indexOf(char) === -1) starts.push(i);
  }
  return starts;
}

function range(start: number, length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) out.push(start + i);
  return out;
}

function matchSubsequence(query: string, target: string, starts: readonly number[]): FuzzyMatch | undefined {
  const positions: number[] = [];
  let score = SCORE_SUBSEQUENCE;
  let cursor = 0;
  let previousIndex = -1;

  for (let q = 0; q < query.length; q += 1) {
    const index = target.indexOf(query.charAt(q), cursor);
    if (index === -1) return undefined;

    if (starts.indexOf(index) !== -1) score += WORD_START_BONUS;
    if (index === previousIndex + 1) score += CONSECUTIVE_BONUS;
    else if (previousIndex >= 0) score -= (index - previousIndex - 1) * GAP_PENALTY;

    positions.push(index);
    previousIndex = index;
    cursor = index + 1;
  }

  return { score: score - target.length * LENGTH_PENALTY, positions };
}

/**
 * Scores `query` against `target`.
 *
 * An empty query matches everything with score 0, which is what lets the
 * palette show favourites and recents before the user types anything.
 * Returns `undefined` when the query cannot be matched at all.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | undefined {
  if (query.length === 0) return { score: 0, positions: [] };
  if (target.length === 0) return undefined;

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const lengthAdjustment = target.length * LENGTH_PENALTY;

  if (q === t) return { score: SCORE_EXACT, positions: range(0, target.length) };

  if (t.indexOf(q) === 0) {
    return { score: SCORE_PREFIX - lengthAdjustment, positions: range(0, q.length) };
  }

  const starts = wordStarts(target);

  // A word prefix: "top" matching "Move to Top".
  for (let s = 0; s < starts.length; s += 1) {
    const start = starts[s] as number;
    if (t.substring(start, start + q.length) === q) {
      return {
        score: SCORE_WORD_PREFIX - start * POSITION_PENALTY - lengthAdjustment,
        positions: range(start, q.length),
      };
    }
  }

  // An acronym: "mtt" matching "Move to Top".
  let acronym = "";
  for (let s = 0; s < starts.length; s += 1) acronym += t.charAt(starts[s] as number);
  if (acronym.indexOf(q) === 0) {
    return {
      score: SCORE_ACRONYM - lengthAdjustment,
      positions: starts.slice(0, q.length),
    };
  }

  const substringAt = t.indexOf(q);
  if (substringAt > 0) {
    return {
      score: SCORE_SUBSTRING - substringAt * POSITION_PENALTY - lengthAdjustment,
      positions: range(substringAt, q.length),
    };
  }

  return matchSubsequence(q, t, starts);
}
