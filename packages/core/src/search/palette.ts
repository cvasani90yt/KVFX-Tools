import type { Command, CommandContext } from "../commands/types.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { KvfxSettings } from "../storage/settings.js";
import { fuzzyMatch } from "./fuzzy.js";

/**
 * Turns the command registry into a ranked palette list.
 *
 * Two behaviours matter more than the scoring details.
 *
 * **Unavailable commands are ranked last, never hidden.** A list that makes
 * entries disappear teaches the user nothing; one that shows "Select a layer
 * first" teaches the rule once and is then never confusing again.
 *
 * **Personal weighting stays inside its tier.** Favourite and usage bonuses are
 * far smaller than the gap between match tiers, so a pinned command can win a
 * close race but can never outrank a better textual match. The first result
 * therefore always makes sense for what was typed.
 */

export interface PaletteEntry {
  readonly command: Command;
  readonly available: boolean;
  readonly reason: string | undefined;
  readonly isFavourite: boolean;
  readonly score: number;
  /** Indices in `command.name` to highlight. Empty unless the name matched. */
  readonly positions: readonly number[];
  readonly matchedOn: "name" | "keyword" | "category" | "description" | "none";
  /** The keyword that matched, when `matchedOn` is "keyword". */
  readonly matchedKeyword: string | undefined;
  /** The effective binding: the user's override, else the command's default. */
  readonly shortcut: string | undefined;
  /**
   * How well the query matched the command's *name*, ignoring other fields.
   *
   * Used only to break ties. Several commands can claim the same keyword —
   * "top" belongs to Align Top, Move to Top and three anchor spots — and an
   * exact keyword hit scores all of them identically. Falling straight to
   * alphabetical order then buries the command the user most likely meant.
   */
  readonly nameScore: number;
}

/** Field weights. The name is what users aim at; the rest are safety nets. */
const WEIGHT_NAME = 1;
const WEIGHT_KEYWORD = 0.8;
const WEIGHT_CATEGORY = 0.5;
const WEIGHT_DESCRIPTION = 0.4;

/** Personal weighting. Deliberately far below the tier gap in `fuzzy.ts`. */
const FAVOURITE_BONUS = 150;
const FREQUENCY_BONUS = 8;
const MAX_COUNTED_USES = 10;

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

const HOUR_MS = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;
const WEEK_MS = DAYS_PER_WEEK * DAY_MS;

/**
 * Recency buckets rather than a decay curve.
 *
 * Buckets are predictable: a command used in the last hour keeps a steady
 * advantage instead of drifting down the list while the user watches.
 */
const BONUS_WITHIN_HOUR = 60;
const BONUS_WITHIN_DAY = 30;
const BONUS_WITHIN_WEEK = 10;

function recencyBonus(lastUsedMs: number, nowMs: number): number {
  if (lastUsedMs <= 0) return 0;
  const age = nowMs - lastUsedMs;
  if (age < HOUR_MS) return BONUS_WITHIN_HOUR;
  if (age < DAY_MS) return BONUS_WITHIN_DAY;
  if (age < WEEK_MS) return BONUS_WITHIN_WEEK;
  return 0;
}

interface FieldMatch {
  readonly score: number;
  readonly positions: readonly number[];
  readonly matchedOn: PaletteEntry["matchedOn"];
  readonly matchedKeyword: string | undefined;
}

function bestFieldMatch(query: string, command: Command): FieldMatch | undefined {
  const byName = fuzzyMatch(query, command.name);
  let best: FieldMatch | undefined =
    byName === undefined
      ? undefined
      : {
          score: byName.score * WEIGHT_NAME,
          positions: byName.positions,
          matchedOn: "name",
          matchedKeyword: undefined,
        };

  for (const keyword of command.keywords) {
    const match = fuzzyMatch(query, keyword);
    if (match === undefined) continue;
    const score = match.score * WEIGHT_KEYWORD;
    if (best === undefined || score > best.score) {
      best = { score, positions: [], matchedOn: "keyword", matchedKeyword: keyword };
    }
  }

  const byCategory = fuzzyMatch(query, command.category);
  if (byCategory !== undefined) {
    const score = byCategory.score * WEIGHT_CATEGORY;
    if (best === undefined || score > best.score) {
      best = { score, positions: [], matchedOn: "category", matchedKeyword: undefined };
    }
  }

  const byDescription = fuzzyMatch(query, command.description);
  if (byDescription !== undefined) {
    const score = byDescription.score * WEIGHT_DESCRIPTION;
    if (best === undefined || score > best.score) {
      best = { score, positions: [], matchedOn: "description", matchedKeyword: undefined };
    }
  }

  return best;
}

export interface PaletteOptions {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  readonly settings: KvfxSettings;
  readonly query: string;
  readonly nowMs: number;
  /** Cap on returned entries. Omit for all of them. */
  readonly limit?: number;
}

export function buildPalette(options: PaletteOptions): readonly PaletteEntry[] {
  const { registry, context, settings, nowMs } = options;
  const query = options.query.trim();
  const resolved = registry.resolve(context);

  const entries: PaletteEntry[] = [];

  for (const { command, available, reason } of resolved) {
    if (command.metadata.hidden === true) continue;

    const isFavourite = settings.favourites.includes(command.id);
    const usage = settings.usage[command.id];
    const personal =
      (isFavourite ? FAVOURITE_BONUS : 0) +
      Math.min(usage?.count ?? 0, MAX_COUNTED_USES) * FREQUENCY_BONUS +
      recencyBonus(usage?.lastUsedMs ?? 0, nowMs);

    const shortcut = settings.shortcuts[command.id] ?? command.defaultShortcut;

    if (query.length === 0) {
      entries.push({
        command,
        available,
        reason,
        isFavourite,
        score: personal,
        positions: [],
        matchedOn: "none",
        matchedKeyword: undefined,
        shortcut,
        nameScore: 0,
      });
      continue;
    }

    const match = bestFieldMatch(query, command);
    if (match === undefined) continue;

    entries.push({
      command,
      available,
      reason,
      isFavourite,
      score: match.score + personal,
      positions: match.positions,
      matchedOn: match.matchedOn,
      matchedKeyword: match.matchedKeyword,
      shortcut,
      nameScore: fuzzyMatch(query, command.name)?.score ?? 0,
    });
  }

  entries.sort((a, b) => compare(a, b, query.length === 0, settings));

  return options.limit === undefined ? entries : entries.slice(0, options.limit);
}

function compare(
  a: PaletteEntry,
  b: PaletteEntry,
  isBrowsing: boolean,
  settings: KvfxSettings,
): number {
  // Actionable commands first. This is why the list reorders as the selection
  // changes, which is correct: the palette reflects what you can do right now.
  if (a.available !== b.available) return a.available ? -1 : 1;

  if (isBrowsing) {
    // With no query, show the user's own shape: pinned, then recent, then the
    // rest alphabetically so browsing is stable and predictable.
    const favouriteRank = (entry: PaletteEntry): number =>
      entry.isFavourite ? settings.favourites.indexOf(entry.command.id) : Number.MAX_SAFE_INTEGER;
    const byFavourite = favouriteRank(a) - favouriteRank(b);
    if (byFavourite !== 0) return byFavourite;

    const recentRank = (entry: PaletteEntry): number => {
      const index = settings.recents.indexOf(entry.command.id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    const byRecent = recentRank(a) - recentRank(b);
    if (byRecent !== 0) return byRecent;

    return a.command.name.localeCompare(b.command.name);
  }

  if (a.score !== b.score) return b.score - a.score;

  // Tie: prefer the command whose name matched better. This respects where in
  // the name the match landed rather than just how long the name is, so "top"
  // ranks Align Top and Move to Top above Anchor to Top Left.
  if (a.nameScore !== b.nameScore) return b.nameScore - a.nameScore;

  return a.command.name.localeCompare(b.command.name);
}
