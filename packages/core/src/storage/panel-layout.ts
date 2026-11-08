import {
  type KvfxSettings,
  MAX_CUSTOM_LAYOUTS,
  MAX_LAYOUT_NAME,
  type PanelLayout,
  type UiSettings,
  setUiSetting,
} from "./settings.js";

/**
 * Panel layouts: the built-in presets, and reading, applying, saving and
 * comparing layouts.
 *
 * A layout is how the panel is arranged — tab order, hidden tabs, what the tab
 * buttons show, where the tab bar sits, whether the anchor-and-creators bar
 * and the align bar show, and spacing. Sections inside a tab are left as the
 * user set them: a preset rearranges the panel, it doesn't hide tools inside
 * a tab the user chose to keep.
 */

export interface PanelLayoutPreset {
  readonly id: string;
  readonly name: string;
  /** One line for the gallery. */
  readonly about: string;
  readonly layout: PanelLayout;
}

/** The panel's tabs in their built-in order. */
export const DEFAULT_TAB_ORDER: readonly string[] = ["tools", "ease", "text", "fx", "generate", "labels", "library", "media"];

const base: PanelLayout = {
  tabOrder: DEFAULT_TAB_ORDER,
  hiddenTabs: [],
  tabStyle: "both",
  tabPosition: "top",
  quickBar: true,
  alignBar: true,
  compact: false,
};

export const PANEL_LAYOUTS: readonly PanelLayoutPreset[] = [
  {
    id: "full",
    name: "Full",
    about: "Everything in view: labelled tabs, the anchor grid and creators, and the align bar.",
    layout: base,
  },
  {
    id: "compact",
    name: "Compact",
    about: "Tighter spacing and icon-only tabs, for a small docked panel.",
    layout: { ...base, tabStyle: "icons", compact: true },
  },
  {
    id: "minimal",
    name: "Minimal",
    about: "Just the tabs and the tools inside them — no anchor grid, creators or align bar.",
    layout: { ...base, tabStyle: "icons", quickBar: false, alignBar: false, compact: true },
  },
  {
    id: "motion",
    name: "Motion",
    about: "For animators: Ease, Text and Generate first, with the align bar under them.",
    layout: { ...base, tabOrder: ["ease", "text", "generate", "tools", "fx", "library", "labels", "media"], hiddenTabs: ["labels", "media"], quickBar: false },
  },
  {
    id: "editor",
    name: "Editor",
    about: "For video edits: Generate (transitions, speed ramps) and Media first, tabs along the bottom.",
    layout: {
      ...base,
      tabOrder: ["generate", "media", "tools", "fx", "labels", "library", "text", "ease"],
      hiddenTabs: ["ease"],
      tabPosition: "bottom",
      quickBar: false,
      alignBar: false,
    },
  },
  {
    id: "designer",
    name: "Designer",
    about: "For layouts and type: Tools, Text and Generate first, with text-only tabs.",
    layout: { ...base, tabOrder: ["tools", "text", "generate", "labels", "library", "ease", "fx", "media"], hiddenTabs: ["media"], tabStyle: "labels" },
  },
];

export function panelLayoutById(id: unknown): PanelLayoutPreset | undefined {
  return PANEL_LAYOUTS.find((p) => p.id === id);
}

/** `ids` ordered by `order`: listed ids first in that order, the rest after in their own order. */
export function orderTabs(ids: readonly string[], order: readonly string[]): string[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return ids
    .map((id, i) => ({ id, i, r: rank.get(id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.id);
}

/** The panel's layout as the settings have it now. */
export function currentLayout(ui: UiSettings): PanelLayout {
  return {
    tabOrder: ui.tabOrder,
    hiddenTabs: ui.hiddenTabs,
    tabStyle: ui.tabStyle,
    tabPosition: ui.tabPosition,
    quickBar: ui.quickBar,
    alignBar: ui.alignBar,
    compact: ui.compact,
  };
}

/** The tabs a layout shows, in its order, out of `tabIds` — never none. */
export function visibleTabs(layout: PanelLayout, tabIds: readonly string[]): string[] {
  const ordered = orderTabs(tabIds, layout.tabOrder);
  const shown = ordered.filter((id) => !layout.hiddenTabs.includes(id));
  return shown.length > 0 ? shown : ordered.slice(0, 1);
}

/** Whether two layouts arrange `tabIds` the same way. */
export function sameLayout(a: PanelLayout, b: PanelLayout, tabIds: readonly string[]): boolean {
  const order = (l: PanelLayout): string => visibleTabs(l, tabIds).join(",");
  return (
    order(a) === order(b) &&
    a.tabStyle === b.tabStyle &&
    a.tabPosition === b.tabPosition &&
    a.quickBar === b.quickBar &&
    a.alignBar === b.alignBar &&
    a.compact === b.compact
  );
}

/**
 * Applies a layout. At least one of `tabIds` always stays visible: a layout
 * that would hide them all keeps its first tab.
 */
export function applyLayout(settings: KvfxSettings, layout: PanelLayout, tabIds: readonly string[] = DEFAULT_TAB_ORDER): KvfxSettings {
  const ordered = orderTabs(tabIds, layout.tabOrder);
  let hidden = layout.hiddenTabs.filter((id) => tabIds.includes(id));
  if (ordered.length > 0 && ordered.every((id) => hidden.includes(id))) hidden = hidden.filter((id) => id !== ordered[0]);
  return {
    ...settings,
    ui: {
      ...settings.ui,
      tabOrder: ordered,
      hiddenTabs: hidden,
      tabStyle: layout.tabStyle,
      tabPosition: layout.tabPosition,
      quickBar: layout.quickBar,
      alignBar: layout.alignBar,
      compact: layout.compact,
    },
  };
}

/** Saves the current layout under `name`, replacing one with the same name. */
export function saveLayout(settings: KvfxSettings, name: string, tabIds: readonly string[] = DEFAULT_TAB_ORDER): KvfxSettings {
  const trimmed = name.trim().slice(0, MAX_LAYOUT_NAME);
  if (trimmed.length === 0) return settings;
  const layout = currentLayout(settings.ui);
  const saved = { name: trimmed, layout: { ...layout, tabOrder: orderTabs(tabIds, layout.tabOrder) } };
  const others = settings.ui.customLayouts.filter((l) => l.name !== trimmed);
  return setUiSetting(settings, "customLayouts", [...others, saved].slice(-MAX_CUSTOM_LAYOUTS));
}

export function deleteLayout(settings: KvfxSettings, name: string): KvfxSettings {
  return setUiSetting(
    settings,
    "customLayouts",
    settings.ui.customLayouts.filter((l) => l.name !== name),
  );
}

/** Moves a tab one place left or right among `tabIds` (in their current order). */
export function moveTab(settings: KvfxSettings, tabIds: readonly string[], id: string, delta: -1 | 1): KvfxSettings {
  const order = orderTabs(tabIds, settings.ui.tabOrder);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return settings;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return setUiSetting(settings, "tabOrder", order);
}
