import type { JsonObject } from "../types/json.js";
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
  /** Align grid's reference mode: "auto", "composition", "selection" or "group". */
  readonly alignReference: string;
  /**
   * Ids of tool groups the user has folded away.
   *
   * Stored as the collapsed set rather than the expanded one, so a group added
   * in a later version arrives open: a new feature the user has never seen
   * should not be hidden from them by an old settings file.
   */
  readonly collapsedGroups: readonly string[];
  /** Colour of the Solid button's swatch, "#rrggbb". */
  readonly solidColor: string;
  /** The curve in the easing editor — what "Apply Ease" applies from the palette too. */
  readonly ease: readonly [number, number, number, number];
  /** Curves the user saved, newest last. */
  readonly customEases: readonly SavedEase[];
  /** Tabs the user switched off in Settings ▸ Layout. */
  readonly hiddenTabs: readonly string[];
  /** Folders shown in the Library tab. */
  readonly libraryFolders: readonly string[];
  /** Where pasted media is saved: beside the project, or in KVFX's app data. */
  readonly mediaTarget: "project" | "appData";
  /**
   * Last-used parameters per tool — the counter's range, the carousel's card
   * count — so each tool opens the way the user left it. Values are plain
   * JSON and each tool validates its own on read.
   */
  readonly toolParams: Readonly<Record<string, JsonObject>>;
  /** Hover tooltips on buttons. Reasons a control is disabled always show. */
  readonly tooltips: boolean;
  /** Tighter spacing, for small docked panels. */
  readonly compact: boolean;
  /** Section ids the user switched off in Settings ▸ Sections. */
  readonly hiddenSections: readonly string[];
  /** Section ids in the user's preferred order; sections not listed keep theirs. */
  readonly sectionOrder: readonly string[];
  /** Minutes since the last save before the header suggests saving; 0 is off. */
  readonly saveReminder: number;
}

export interface SavedEase {
  readonly name: string;
  readonly bezier: readonly [number, number, number, number];
}

export const MAX_CUSTOM_EASES = 24;
export const MAX_LIBRARY_FOLDERS = 12;

export const DEFAULT_UI_SETTINGS: UiSettings = {
  activeTab: "tools",
  alignReference: "auto",
  collapsedGroups: [],
  solidColor: "#ffffff",
  // After Effects' Easy Ease; duplicated from animation/easing.ts to keep
  // storage free of feature imports.
  // eslint-disable-next-line no-magic-numbers
  ease: [0.333, 0, 0.667, 1],
  customEases: [],
  hiddenTabs: [],
  libraryFolders: [],
  mediaTarget: "project",
  toolParams: {},
  tooltips: true,
  compact: false,
  hiddenSections: [],
  sectionOrder: [],
  saveReminder: 20,
};

/** Choices offered for the save reminder, in minutes. */
// eslint-disable-next-line no-magic-numbers -- the choices themselves
export const SAVE_REMINDER_MINUTES: readonly number[] = [0, 10, 20, 30, 60];

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

function bezierOf(value: unknown): readonly [number, number, number, number] | undefined {
  // eslint-disable-next-line no-magic-numbers -- four bezier coordinates
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const [x1, y1, x2, y2] = value as number[];
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return undefined;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return undefined;
  return [x1, y1, x2, y2];
}

function savedEases(value: unknown): SavedEase[] {
  if (!Array.isArray(value)) return [];
  const out: SavedEase[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = entry["name"];
    const bezier = bezierOf(entry["bezier"]);
    if (typeof name === "string" && name.length > 0 && bezier !== undefined) out.push({ name, bezier });
    if (out.length >= MAX_CUSTOM_EASES) break;
  }
  return out;
}

function toolParams(value: unknown): Record<string, JsonObject> {
  if (!isRecord(value)) return {};
  const out: Record<string, JsonObject> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isRecord(entry)) out[key] = entry as JsonObject;
  }
  return out;
}

function uiSettings(value: unknown): UiSettings {
  if (!isRecord(value)) return DEFAULT_UI_SETTINGS;
  const activeTab = value["activeTab"];
  const alignReference = value["alignReference"];
  const solidColor = value["solidColor"];
  return {
    activeTab: typeof activeTab === "string" && activeTab.length > 0 ? activeTab : DEFAULT_UI_SETTINGS.activeTab,
    alignReference:
      alignReference === "auto" ||
      alignReference === "composition" ||
      alignReference === "selection" ||
      alignReference === "group"
        ? alignReference
        : DEFAULT_UI_SETTINGS.alignReference,
    collapsedGroups: stringList(value["collapsedGroups"]),
    solidColor:
      typeof solidColor === "string" && /^#[0-9a-f]{6}$/i.test(solidColor)
        ? solidColor.toLowerCase()
        : DEFAULT_UI_SETTINGS.solidColor,
    ease: bezierOf(value["ease"]) ?? DEFAULT_UI_SETTINGS.ease,
    customEases: savedEases(value["customEases"]),
    hiddenTabs: stringList(value["hiddenTabs"]),
    libraryFolders: stringList(value["libraryFolders"], MAX_LIBRARY_FOLDERS),
    mediaTarget: value["mediaTarget"] === "appData" ? "appData" : "project",
    toolParams: toolParams(value["toolParams"]),
    tooltips: value["tooltips"] !== false,
    compact: value["compact"] === true,
    hiddenSections: stringList(value["hiddenSections"]),
    sectionOrder: stringList(value["sectionOrder"]),
    saveReminder: SAVE_REMINDER_MINUTES.includes(value["saveReminder"] as number)
      ? (value["saveReminder"] as number)
      : DEFAULT_UI_SETTINGS.saveReminder,
  };
}

/**
 * Moves a section one place up or down among `siblings` (in their current
 * order), recording the whole sibling order so the move sticks.
 */
export function moveSection(settings: KvfxSettings, siblings: readonly string[], id: string, delta: -1 | 1): KvfxSettings {
  const order = [...siblings];
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return settings;
  order.splice(from, 1);
  order.splice(to, 0, id);
  const rest = settings.ui.sectionOrder.filter((s) => !order.includes(s));
  return setUiSetting(settings, "sectionOrder", [...rest, ...order]);
}

/** Remembers a tool's parameters, merged over what was stored before. */
export function setToolParams(settings: KvfxSettings, toolId: string, params: JsonObject): KvfxSettings {
  const previous = settings.ui.toolParams[toolId] ?? {};
  return setUiSetting(settings, "toolParams", {
    ...settings.ui.toolParams,
    [toolId]: { ...previous, ...params },
  });
}

/** Saves a named curve, replacing one with the same name. */
export function saveEase(settings: KvfxSettings, name: string, bezier: readonly [number, number, number, number]): KvfxSettings {
  const trimmed = name.trim();
  if (trimmed.length === 0) return settings;
  const others = settings.ui.customEases.filter((e) => e.name !== trimmed);
  const next = [...others, { name: trimmed, bezier }].slice(-MAX_CUSTOM_EASES);
  return setUiSetting(settings, "customEases", next);
}

export function deleteEase(settings: KvfxSettings, name: string): KvfxSettings {
  return setUiSetting(
    settings,
    "customEases",
    settings.ui.customEases.filter((e) => e.name !== name),
  );
}

export function toggleListEntry(list: readonly string[], entry: string): string[] {
  return list.includes(entry) ? list.filter((e) => e !== entry) : [...list, entry];
}

export function toggleGroupCollapsed(settings: KvfxSettings, groupId: string): KvfxSettings {
  const collapsed = settings.ui.collapsedGroups.includes(groupId);
  return {
    ...settings,
    ui: {
      ...settings.ui,
      collapsedGroups: collapsed
        ? settings.ui.collapsedGroups.filter((id) => id !== groupId)
        : [...settings.ui.collapsedGroups, groupId],
    },
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
