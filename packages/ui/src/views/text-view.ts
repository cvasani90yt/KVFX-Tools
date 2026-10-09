import {
  type JsonValue,
  STAGGER_ORDERS,
  TEXT_CATEGORIES,
  TEXT_EASES,
  TEXT_MOTION_PRESETS,
  type TextMotionOptions,
  type TextMotionPreset,
  hexToRgb,
  parseOrder,
  ref,
} from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import {
  CommandButtons,
  Section,
  actionButton,
  colorField,
  hint,
  numberField,
  row,
  segmented,
  selectField,
  textField,
} from "../ui/controls.js";
import { clear, h, setText, toggleClass } from "../ui/dom.js";
import { buildKineticSection } from "./kinetic-section.js";
import { TextPreview } from "./text-preview.js";

/**
 * TEXT: create styled text, animate it with presets, explode it into pieces,
 * and swap fonts across the whole project.
 */

const FONT_SEARCH_DELAY_MS = 250;
const FONT_RESULTS = 40;
const DEFAULT_SIZE = 120;
/** Presets remembered under Recent. */
const RECENT_COUNT = 8;
const SEED_RANGE = 99_999;
const FALLBACK_FPS = 25;
const DEFAULTS = { stagger: 2, duration: 15, overshoot: 30 } as const;
const DEFAULT_ACCENT = hexToRgb("#ff8f3f") ?? ([1, 1, 1] as const);

interface UsedFont {
  readonly postScriptName: string;
  readonly family: string;
  readonly style: string;
  readonly uses: number;
}

type Filter = "all" | "favourites" | "recent" | (typeof TEXT_CATEGORIES)[number];

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export class TextView implements View {
  readonly id = "text";
  readonly label = "Text";
  readonly icon = "tab-text";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #buttons: CommandButtons;
  readonly #sections: Section[] = [];
  readonly #content: HTMLInputElement;
  readonly #font: HTMLInputElement;
  readonly #fontList: HTMLDataListElement;
  readonly #size: HTMLInputElement;
  readonly #color: HTMLInputElement;
  readonly #tracking: HTMLInputElement;
  readonly #stage: HTMLElement;
  readonly #preview: TextPreview;
  readonly #tiles: HTMLElement;
  readonly #filters: HTMLElement;
  readonly #presetTiles = new Map<string, HTMLButtonElement>();
  readonly #favouriteButton: HTMLButtonElement;
  readonly #fontsList: HTMLElement;
  readonly #motion: {
    mode: string;
    unit: string;
    order: HTMLSelectElement;
    ease: HTMLSelectElement;
    stagger: HTMLInputElement;
    duration: HTMLInputElement;
    overshoot: HTMLInputElement;
    engine: string;
    accent: HTMLInputElement;
  };
  #preset: TextMotionPreset;
  #filter: Filter = "all";
  #seed = 1;
  #explodeMode: string;
  #fontTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);
    const session = panel.session;
    const style = session.toolParams("textStyle");
    const animate = session.toolParams("textAnimate");
    const explode = session.toolParams("explode");

    // --- style --------------------------------------------------------------
    this.#fontList = h("datalist", { attrs: { id: "kvfx-fonts" } });
    const content = textField("Text", typeof style["text"] === "string" ? style["text"] : "Your title");
    this.#content = content.input;
    const font = textField("Font", typeof style["font"] === "string" ? style["font"] : "", undefined, "PostScript name, e.g. Inter-Bold");
    this.#font = font.input;
    this.#font.setAttribute("list", "kvfx-fonts");
    this.#font.addEventListener("input", () => this.#searchFonts(this.#font.value));
    const size = numberField("Size", typeof style["fontSize"] === "number" ? style["fontSize"] : DEFAULT_SIZE, { min: 1, step: 1, unit: "px" });
    this.#size = size.input;
    const color = colorField("Colour", typeof style["color"] === "string" ? style["color"] : "#ffffff");
    this.#color = color.input;
    const tracking = numberField("Track", typeof style["tracking"] === "number" ? style["tracking"] : 0, { step: 10 });
    this.#tracking = tracking.input;

    const styleSection = this.#section("text.style", "Style");
    styleSection.body.append(
      content.root,
      font.root,
      this.#fontList,
      row(size.root, tracking.root, color.root),
      h(
        "div",
        { class: "kvfx-actions" },
        actionButton("Create Text", () => void this.#create(), { icon: "text", variant: "wide" }),
        this.#buttons.button("kvfx.text.style", { label: "Apply Style", icon: "text-style", variant: "wide", params: () => this.#styleParams() }),
      ),
    );

    // --- animate ------------------------------------------------------------
    this.#preset = TEXT_MOTION_PRESETS.find((p) => p.id === animate["preset"]) ?? TEXT_MOTION_PRESETS[2] ?? (TEXT_MOTION_PRESETS[0] as TextMotionPreset);
    this.#stage = h("div", { class: "kvfx-stage", attrs: { "aria-hidden": "true" } });
    this.#preview = new TextPreview(this.#stage);
    this.#tiles = h("div", { class: "kvfx-tiles kvfx-tiles--scroll" });
    for (const preset of TEXT_MOTION_PRESETS) {
      const tile = h("button", {
        class: "kvfx-tile",
        type: "button",
        text: preset.name,
        title: `${preset.name} — ${preset.category}`,
        on: {
          click: () => {
            this.#preset = preset;
            session.setToolParams("textAnimate", { preset: preset.id });
            this.#highlightPreset();
            this.#play();
          },
          mouseenter: () => this.#play(preset),
          mouseleave: () => this.#play(),
        },
      });
      this.#presetTiles.set(preset.id, tile);
      this.#tiles.append(tile);
    }

    // Category filter: everything, favourites, recently applied, then each family.
    this.#filters = h("div", { class: "kvfx-filters", attrs: { role: "tablist", "aria-label": "Preset categories" } });
    const filterOptions: { value: Filter; label: string }[] = [
      { value: "all", label: "All" },
      { value: "favourites", label: "★" },
      { value: "recent", label: "Recent" },
      ...TEXT_CATEGORIES.map((c) => ({ value: c, label: c })),
    ];
    for (const option of filterOptions) {
      this.#filters.append(
        h("button", {
          class: "kvfx-filter",
          type: "button",
          text: option.label,
          title: option.value === "favourites" ? "Favourites" : option.label,
          attrs: { "data-filter": option.value },
          on: {
            click: () => {
              this.#filter = option.value;
              this.#applyFilter();
            },
          },
        }),
      );
    }

    const n = (key: string, fallback: number): number => (typeof animate[key] === "number" ? animate[key] : fallback);
    const replay = (): void => this.#play();
    const remember = (patch: Record<string, JsonValue>): void => {
      session.setToolParams("textAnimate", patch);
      replay();
    };
    let mode = typeof animate["mode"] === "string" ? animate["mode"] : "in";
    const modeSeg = segmented(
      [
        { value: "in", label: "In" },
        { value: "out", label: "Out" },
        { value: "inOut", label: "In+Out", title: "In from the playhead, out at the layer's end" },
      ],
      mode,
      (value) => {
        mode = value;
        this.#motion.mode = value;
        modeSeg.set(value);
        remember({ mode: value });
      },
    );
    let unit = typeof animate["unit"] === "string" ? animate["unit"] : "characters";
    const unitSeg = segmented(
      [
        { value: "characters", label: "Chars" },
        { value: "words", label: "Words" },
        { value: "lines", label: "Lines" },
      ],
      unit,
      (value) => {
        unit = value;
        this.#motion.unit = value;
        unitSeg.set(value);
        remember({ unit: value });
      },
    );
    const order = selectField(
      "Order",
      STAGGER_ORDERS.map((o) => ({ value: o.id, label: o.label })),
      parseOrder(animate["order"]),
      (value) => {
        this.#seed = 1 + Math.floor(Math.random() * SEED_RANGE);
        remember({ order: value });
      },
    );
    const ease = selectField(
      "Ease",
      TEXT_EASES.map((e) => ({ value: e.id, label: e.label })),
      typeof animate["ease"] === "string" ? animate["ease"] : "preset",
      (value) => remember({ ease: value }),
    );
    const stagger = numberField("Stagger", n("stagger", DEFAULTS.stagger), { min: 0, step: 1, unit: "fr", onChange: (v) => remember({ stagger: v }) });
    const duration = numberField("Each", n("duration", DEFAULTS.duration), { min: 1, step: 1, unit: "fr", onChange: (v) => remember({ duration: v }) });
    const overshoot = numberField("Overshoot", n("overshoot", DEFAULTS.overshoot), { min: 0, max: 100, step: 5, unit: "%", onChange: (v) => remember({ overshoot: v }) });
    let engine = animate["engine"] === "keys" ? "keys" : "live";
    const engineSeg = segmented(
      [
        { value: "live", label: "Live", title: "An expression selector: every option, follows text edits" },
        { value: "keys", label: "Keys", title: "Range-selector keyframes you can drag; overshoot is approximated" },
      ],
      engine,
      (value) => {
        engine = value;
        this.#motion.engine = value;
        engineSeg.set(value);
        session.setToolParams("textAnimate", { engine: value });
      },
    );
    const accent = colorField("Accent", typeof animate["accent"] === "string" ? animate["accent"] : "#ff8f3f", (hex) => remember({ accent: hex }));
    this.#motion = {
      mode,
      unit,
      order: order.select,
      ease: ease.select,
      stagger: stagger.input,
      duration: duration.input,
      overshoot: overshoot.input,
      engine,
      accent: accent.input,
    };
    this.#favouriteButton = actionButton("Favourite", () => this.#toggleFavourite(), { icon: "star", variant: "tool", title: "Add this preset to ★ favourites" });

    const animateSection = this.#section("text.animate", "Animate", "from the playhead");
    animateSection.body.append(
      this.#stage,
      this.#filters,
      this.#tiles,
      row(modeSeg.root, unitSeg.root),
      row(order.root, ease.root),
      row(stagger.root, duration.root, overshoot.root),
      row(engineSeg.root, accent.root, this.#favouriteButton),
      this.#buttons.button("kvfx.text.animate", {
        label: "Animate Text",
        icon: "text-animate",
        variant: "wide",
        className: "kvfx-primary",
        params: () => this.#animateParams(),
      }),
      hint("Stagger is the gap between units starting; Each is how long one unit takes. Accent colours Colour Typing and Highlight."),
    );

    // --- kinetic title -----------------------------------------------------
    buildKineticSection(panel, this.#buttons, (id, title, hintText) => this.#section(id, title, hintText));

    // --- explode ------------------------------------------------------------
    this.#explodeMode = typeof explode["mode"] === "string" ? explode["mode"] : "characters";
    const modes = segmented(
      [
        { value: "characters", label: "Letters" },
        { value: "words", label: "Words" },
        { value: "lines", label: "Lines" },
      ],
      this.#explodeMode,
      (value) => {
        this.#explodeMode = value;
        modes.set(value);
        session.setToolParams("explode", { mode: value });
      },
    );
    const explodeSection = this.#section("text.explode", "Explode");
    explodeSection.body.append(
      modes.root,
      this.#buttons.button("kvfx.text.explode", {
        label: "Explode Text",
        icon: "explode",
        variant: "wide",
        params: () => ({ mode: this.#explodeMode }),
      }),
      hint("Each piece stays live text in place. The original layer is hidden, not deleted."),
    );

    // --- fonts --------------------------------------------------------------
    this.#fontsList = h("div", { class: "kvfx-list" });
    const fontsSection = this.#section("text.fonts", "Replace Fonts", "whole project");
    fontsSection.body.append(
      actionButton("Scan Project Fonts", () => void this.#scanFonts(), { icon: "search", variant: "wide" }),
      this.#fontsList,
    );

    this.root = h("div", { class: "kvfx-tab" }, ...this.#sections.map((s) => s.root));
    this.#highlightPreset();
    this.#applyFilter();
  }

  #section(id: string, title: string, hintText?: string): Section {
    const section = new Section(this.#panel, id, title, hintText);
    this.#sections.push(section);
    return section;
  }

  #styleParams(): Record<string, string | number> {
    const params: Record<string, string | number> = {
      text: this.#content.value,
      font: this.#font.value.trim(),
      fontSize: Number(this.#size.value) || 0,
      color: this.#color.value,
      tracking: Number(this.#tracking.value) || 0,
    };
    this.#panel.session.setToolParams("textStyle", params);
    return params;
  }

  async #create(): Promise<void> {
    const params = this.#styleParams();
    const style: Record<string, string | number | number[]> = {};
    if (typeof params["font"] === "string" && params["font"].length > 0) style["font"] = params["font"];
    if (typeof params["fontSize"] === "number" && params["fontSize"] > 0) style["fontSize"] = params["fontSize"];
    const rgb = hexToRgb(String(params["color"]));
    if (rgb !== undefined) style["fillColor"] = [...rgb];
    style["tracking"] = Number(params["tracking"]) || 0;
    const text = String(params["text"]).length > 0 ? String(params["text"]) : "Text";
    await this.#panel.session.runPlan("Create Text", [
      { op: "kvfx.op.layer.create", args: { kind: "text", text }, bind: "text" },
      { op: "kvfx.op.text.setStyle", args: { id: ref("text"), ...style } },
    ]);
  }

  #searchFonts(query: string): void {
    if (this.#fontTimer !== undefined) clearTimeout(this.#fontTimer);
    this.#fontTimer = setTimeout(() => void this.#fillFontList(this.#fontList, query), FONT_SEARCH_DELAY_MS);
  }

  async #fillFontList(list: HTMLDataListElement, query: string): Promise<void> {
    const result = await this.#panel.session.query("kvfx.op.fonts.search", { query, limit: FONT_RESULTS });
    if (!result.ok) return;
    const fonts = ((result.value as { fonts?: unknown } | null)?.fonts ?? []) as { postScriptName: string; family: string; style: string }[];
    clear(list);
    for (const f of fonts) list.append(h("option", { attrs: { value: f.postScriptName, label: `${f.family} ${f.style}` } }));
  }

  async #scanFonts(): Promise<void> {
    const result = await this.#panel.session.query("kvfx.op.fonts.used");
    clear(this.#fontsList);
    if (!result.ok) {
      this.#fontsList.append(h("p", { class: "kvfx-hint", text: result.message }));
      return;
    }
    const fonts = ((result.value as { fonts?: unknown } | null)?.fonts ?? []) as UsedFont[];
    if (fonts.length === 0) {
      this.#fontsList.append(h("p", { class: "kvfx-hint", text: "This project uses no fonts yet." }));
      return;
    }
    for (const used of fonts) this.#fontsList.append(this.#fontRow(used));
  }

  #fontRow(used: UsedFont): HTMLElement {
    const listId = `kvfx-fonts-${used.postScriptName.replace(/[^A-Za-z0-9]/g, "")}`;
    const list = h("datalist", { attrs: { id: listId } });
    const target = h("input", {
      class: "kvfx-input",
      type: "text",
      attrs: { list: listId, placeholder: "Replace with…", spellcheck: "false", "aria-label": `Replacement for ${used.family}` },
      on: {
        input: () => {
          if (this.#fontTimer !== undefined) clearTimeout(this.#fontTimer);
          this.#fontTimer = setTimeout(() => void this.#fillFontList(list, target.value), FONT_SEARCH_DELAY_MS);
        },
      },
    });
    const replace = actionButton("Replace", () => void this.#replaceFont(used, target.value.trim()), { variant: "pill" });
    return h(
      "div",
      { class: "kvfx-fontrow" },
      h(
        "div",
        { class: "kvfx-fontrow__name" },
        h("strong", { text: `${used.family} ${used.style}` }),
        h("small", { text: `${used.postScriptName} · ${String(used.uses)} use${used.uses === 1 ? "" : "s"}` }),
      ),
      row(target, replace),
      list,
    );
  }

  async #replaceFont(used: UsedFont, to: string): Promise<void> {
    if (to.length === 0) {
      this.#panel.session.report("Replace font", false, "Choose a font to replace it with.");
      return;
    }
    const ok = await this.#panel.confirm({
      title: "Replace font everywhere?",
      body: `Every use of ${used.family} ${used.style} in this project becomes ${to}. Edit ▸ Undo reverts it.`,
      confirmLabel: "Replace",
    });
    if (!ok) return;
    const value = await this.#panel.session.runPlan("Replace Font", [{ op: "kvfx.op.fonts.replace", args: { from: used.postScriptName, to } }]);
    if (value !== undefined) await this.#scanFonts();
  }

  // --- animate ------------------------------------------------------------

  #fps(): number {
    return this.#panel.session.state.snapshot.comp?.frameRate ?? FALLBACK_FPS;
  }

  /** The motion as the command will build it, for the preview. */
  #options(preset: TextMotionPreset = this.#preset): TextMotionOptions {
    const m = this.#motion;
    const frame = 1 / this.#fps();
    const ease = TEXT_EASES.find((e) => e.id === m.ease.value)?.id ?? "preset";
    return {
      preset,
      mode: m.mode === "out" || m.mode === "inOut" ? m.mode : "in",
      unit: m.unit === "words" || m.unit === "lines" ? m.unit : "characters",
      order: parseOrder(m.order.value),
      seed: this.#seed,
      ease,
      bezier: this.#panel.session.state.settings.ui.ease,
      stagger: Math.max(0, Number(m.stagger.value) || 0) * frame,
      duration: Math.max(1, Number(m.duration.value) || DEFAULTS.duration) * frame,
      overshoot: Math.max(0, Number(m.overshoot.value) || 0),
      engine: m.engine === "keys" ? "keys" : "live",
      accent: hexToRgb(m.accent.value) ?? DEFAULT_ACCENT,
    };
  }

  #animateParams(): Record<string, JsonValue> {
    const m = this.#motion;
    const session = this.#panel.session;
    const recent = [this.#preset.id, ...stringList(session.toolParams("textAnimate")["recent"]).filter((id) => id !== this.#preset.id)].slice(0, RECENT_COUNT);
    session.setToolParams("textAnimate", { recent });
    if (this.#filter === "recent") this.#applyFilter();
    return {
      preset: this.#preset.id,
      mode: m.mode,
      unit: m.unit,
      order: m.order.value,
      seed: this.#seed,
      ease: m.ease.value,
      bezier: [...session.state.settings.ui.ease],
      stagger: Math.max(0, Number(m.stagger.value) || 0),
      duration: Math.max(1, Number(m.duration.value) || DEFAULTS.duration),
      overshoot: Math.max(0, Number(m.overshoot.value) || 0),
      engine: m.engine,
      accent: m.accent.value,
    };
  }

  #favourites(): string[] {
    return stringList(this.#panel.session.toolParams("textAnimate")["favourites"]);
  }

  #toggleFavourite(): void {
    const current = this.#favourites();
    const id = this.#preset.id;
    const next = current.includes(id) ? current.filter((f) => f !== id) : [...current, id];
    this.#panel.session.setToolParams("textAnimate", { favourites: next });
    this.#highlightPreset();
    this.#applyFilter();
  }

  #applyFilter(): void {
    const favourites = new Set(this.#favourites());
    const recent = stringList(this.#panel.session.toolParams("textAnimate")["recent"]);
    for (const [id, tile] of this.#presetTiles) {
      const preset = TEXT_MOTION_PRESETS.find((p) => p.id === id);
      let shown = true;
      if (this.#filter === "favourites") shown = favourites.has(id);
      else if (this.#filter === "recent") shown = recent.includes(id);
      else if (this.#filter !== "all") shown = preset?.category === this.#filter;
      tile.hidden = !shown;
    }
    // Recent lists in the order presets were last used.
    if (this.#filter === "recent") {
      for (const id of [...recent].reverse()) {
        const tile = this.#presetTiles.get(id);
        if (tile !== undefined) this.#tiles.prepend(tile);
      }
    } else {
      for (const preset of TEXT_MOTION_PRESETS) {
        const tile = this.#presetTiles.get(preset.id);
        if (tile !== undefined) this.#tiles.append(tile);
      }
    }
    for (const button of Array.from(this.#filters.querySelectorAll<HTMLButtonElement>(".kvfx-filter"))) {
      toggleClass(button, "kvfx-filter--on", button.dataset["filter"] === this.#filter);
    }
  }

  #highlightPreset(): void {
    const favourites = new Set(this.#favourites());
    for (const [id, tile] of this.#presetTiles) {
      toggleClass(tile, "kvfx-tile--on", id === this.#preset.id);
      const preset = TEXT_MOTION_PRESETS.find((p) => p.id === id);
      setText(tile, `${favourites.has(id) ? "★ " : ""}${preset?.name ?? id}`);
    }
    const on = favourites.has(this.#preset.id);
    toggleClass(this.#favouriteButton, "kvfx-tool--on", on);
    this.#favouriteButton.title = on ? `Remove ${this.#preset.name} from ★ favourites` : `Add ${this.#preset.name} to ★ favourites`;
  }

  #play(preset: TextMotionPreset = this.#preset): void {
    if (!this.root.isConnected) return;
    this.#preview.play(this.#content.value, this.#options(preset));
  }

  shown(): void {
    this.#play();
  }

  update(state: SessionState, availability: Availability): void {
    for (const section of this.#sections) section.update(state);
    this.#buttons.update(state, availability);
  }
}
