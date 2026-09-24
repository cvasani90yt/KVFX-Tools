/**
 * User settings: schema, defaults and migration.
 *
 * Versioned from the first release, because the alternative is discovering you
 * need versioning after users already have files on disk. Migration is
 * forward-only and never destructive: an unreadable or unrecognised file falls
 * back to defaults rather than failing, and a file written by a *newer* build is
 * left strictly alone (see `migrateSettings`).
 */

export const CURRENT_SETTINGS_VERSION = 1;

/** How many recently-used commands to remember. */
export const MAX_RECENTS = 20;

export interface CommandUsage {
  readonly count: number;
  readonly lastUsedMs: number;
}

/** Panel state worth remembering between sessions. */
export interface UiSettings {
  /** Last active tab id. */
  readonly activeTab: string;
  /** Align grid's reference mode: "auto", "composition" or "selection". */
  readonly alignReference: string;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  activeTab: "quick",
  alignReference: "auto",
};

export interface KvfxSettings {
  readonly schemaVersion: number;
  /** Command ids the user pinned. Ordered by when they were added. */
  readonly favourites: readonly string[];
  /** Command ids, most recently used first. */
  readonly recents: readonly string[];
  /** Usage statistics, keyed by command id. */
  readonly usage: Readonly<Record<string, CommandUsage>>;
  /** User overrides, keyed by command id. Always beats a command's default. */
  readonly shortcuts: Readonly<Record<string, string>>;
  readonly ui: UiSettings;
}

export function defaultSettings(): KvfxSettings {
  return {
    schemaVersion: CURRENT_SETTINGS_VERSION,
    favourites: [],
    recents: [],
    usage: {},
    shortcuts: {},
    ui: DEFAULT_UI_SETTINGS,
  };
}

export interface MigrationResult {
  readonly settings: KvfxSettings;
  /**
   * False when the file must not be written back — currently only when it was
   * written by a newer build. Overwriting it would silently discard settings
   * the user made in that build, which they would never get back.
   */
  readonly writable: boolean;
  /** Human-readable notes for the diagnostics view. Empty on a clean load. */
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, limit?: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && !out.includes(entry)) out.push(entry);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

function usageMap(value: unknown): Record<string, CommandUsage> {
  if (!isRecord(value)) return {};
  const out: Record<string, CommandUsage> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const count = entry["count"];
    const lastUsedMs = entry["lastUsedMs"];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    out[id] = {
      count: Math.floor(count),
      lastUsedMs: typeof lastUsedMs === "number" && Number.isFinite(lastUsedMs) ? lastUsedMs : 0,
    };
  }
  return out;
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.length > 0) out[key] = entry;
  }
  return out;
}

/**
 * Loads settings from whatever was on disk.
 *
 * Every field is validated individually, so one corrupt key costs that key and
 * not the whole file — losing a user's favourites because their shortcut map
 * was malformed would be a poor trade.
 */
export function migrateSettings(raw: unknown): MigrationResult {
  if (raw === undefined || raw === null) {
    return { settings: defaultSettings(), writable: true, warnings: [] };
  }

  if (!isRecord(raw)) {
    return {
      settings: defaultSettings(),
      writable: true,
      warnings: ["Settings file was not an object; defaults restored."],
    };
  }

  const version = raw["schemaVersion"];
  if (typeof version === "number" && version > CURRENT_SETTINGS_VERSION) {
    // A newer build wrote this. Read what we understand, change nothing.
    return {
      settings: { ...readFields(raw), schemaVersion: version },
      writable: false,
      warnings: [
        `Settings were written by a newer version of KVFX Tools (schema ${String(version)}). ` +
          "They will be used but not modified, so nothing is lost if you upgrade again.",
      ],
    };
  }

  const warnings: string[] = [];
  if (typeof version !== "number") {
    warnings.push("Settings file had no schema version; treated as the oldest format.");
  }

  return { settings: readFields(raw), writable: true, warnings };
}

function uiSettings(value: unknown): UiSettings {
  if (!isRecord(value)) return DEFAULT_UI_SETTINGS;
  const activeTab = value["activeTab"];
  const alignReference = value["alignReference"];
  return {
    activeTab: typeof activeTab === "string" && activeTab.length > 0 ? activeTab : DEFAULT_UI_SETTINGS.activeTab,
    alignReference:
      alignReference === "auto" || alignReference === "composition" || alignReference === "selection"
        ? alignReference
        : DEFAULT_UI_SETTINGS.alignReference,
  };
}

function readFields(raw: Record<string, unknown>): KvfxSettings {
  return {
    schemaVersion: CURRENT_SETTINGS_VERSION,
    favourites: stringList(raw["favourites"]),
    recents: stringList(raw["recents"], MAX_RECENTS),
    usage: usageMap(raw["usage"]),
    shortcuts: stringMap(raw["shortcuts"]),
    ui: uiSettings(raw["ui"]),
  };
}

export function setUiSetting<K extends keyof UiSettings>(
  settings: KvfxSettings,
  key: K,
  value: UiSettings[K],
): KvfxSettings {
  return { ...settings, ui: { ...settings.ui, [key]: value } };
}

// ---------------------------------------------------------------------------
// Updates — all pure, all returning new settings
// ---------------------------------------------------------------------------

export function recordUsage(settings: KvfxSettings, commandId: string, nowMs: number): KvfxSettings {
  const previous = settings.usage[commandId];
  const recents = [commandId, ...settings.recents.filter((id) => id !== commandId)].slice(0, MAX_RECENTS);

  return {
    ...settings,
    recents,
    usage: {
      ...settings.usage,
      [commandId]: { count: (previous?.count ?? 0) + 1, lastUsedMs: nowMs },
    },
  };
}

export function toggleFavourite(settings: KvfxSettings, commandId: string): KvfxSettings {
  const isFavourite = settings.favourites.includes(commandId);
  return {
    ...settings,
    favourites: isFavourite
      ? settings.favourites.filter((id) => id !== commandId)
      : [...settings.favourites, commandId],
  };
}

export function setShortcut(
  settings: KvfxSettings,
  commandId: string,
  shortcut: string | undefined,
): KvfxSettings {
  const next = { ...settings.shortcuts };
  if (shortcut === undefined || shortcut.length === 0) delete next[commandId];
  else next[commandId] = shortcut;
  return { ...settings, shortcuts: next };
}

/**
 * Drops settings referring to commands that no longer exist.
 *
 * Run on load. Without it, a renamed command leaves a permanent orphan in the
 * user's favourites that they cannot see or remove.
 */
export function pruneUnknownCommands(settings: KvfxSettings, knownIds: ReadonlySet<string>): KvfxSettings {
  const usage: Record<string, CommandUsage> = {};
  for (const [id, entry] of Object.entries(settings.usage)) {
    if (knownIds.has(id)) usage[id] = entry;
  }
  const shortcuts: Record<string, string> = {};
  for (const [id, entry] of Object.entries(settings.shortcuts)) {
    if (knownIds.has(id)) shortcuts[id] = entry;
  }

  return {
    ...settings,
    favourites: settings.favourites.filter((id) => knownIds.has(id)),
    recents: settings.recents.filter((id) => knownIds.has(id)),
    usage,
    shortcuts,
  };
}
