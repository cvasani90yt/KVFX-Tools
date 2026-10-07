import { type CharacterState, TEXT_PRESETS, type TextPreset, hexToRgb, ref } from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { CommandButtons, Section, actionButton, colorField, hint, numberField, row, segmented, textField } from "../ui/controls.js";
import { clear, h, toggleClass } from "../ui/dom.js";

/**
 * TEXT: create styled text, animate it with presets, explode it into pieces,
 * and swap fonts across the whole project.
 */

const FONT_SEARCH_DELAY_MS = 250;
const FONT_RESULTS = 40;
const PREVIEW_PAUSE_MS = 900;
const SNAP_MS = 1;
const SMOOTH_SHARE = 0.45;
const MIN_CHAR_MS = 60;

interface UsedFont {
  readonly postScriptName: string;
  readonly family: string;
  readonly style: string;
  readonly uses: number;
}

 
const OPACITY_SCALE = 100;
const SCALE_PERCENT = 100;
/** After Effects blur radius reads stronger than CSS blur; this keeps the preview honest. */
const BLUR_RATIO = 4;
/** Tracking is in thousandths of an em; at the preview's 22px that is about 1/40 px per unit. */
const TRACKING_RATIO = 40;
const MAX_PREVIEW_CHARS = 24;
const MIN_SPEED = 0.1;
const MS = 1000;
const DEFAULT_SIZE = 120;
 

function keyframeFor(state: CharacterState): Keyframe {
  const transforms: string[] = [];
  if (state.x !== undefined || state.y !== undefined) transforms.push(`translate(${String(state.x ?? 0)}px, ${String(state.y ?? 0)}px)`);
  if (state.scale !== undefined) transforms.push(`scale(${String(state.scale / SCALE_PERCENT)})`);
  if (state.rotation !== undefined) transforms.push(`rotate(${String(state.rotation)}deg)`);
  return {
    opacity: String(state.opacity === undefined ? 1 : state.opacity / OPACITY_SCALE),
    transform: transforms.length > 0 ? transforms.join(" ") : "none",
    filter: state.blur === undefined ? "blur(0px)" : `blur(${String(state.blur / BLUR_RATIO)}px)`,
    marginRight: state.tracking === undefined ? "0px" : `${String(state.tracking / TRACKING_RATIO)}px`,
  };
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
  readonly #presetTiles = new Map<string, HTMLButtonElement>();
  readonly #fontsList: HTMLElement;
  #preset: TextPreset;
  #speed: HTMLInputElement;
  #explodeMode: string;
  #fontTimer: ReturnType<typeof setTimeout> | undefined;
  #animations: Animation[] = [];
  #loopTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.#preset = TEXT_PRESETS.find((p) => p.id === animate["preset"]) ?? TEXT_PRESETS[2] ?? (TEXT_PRESETS[0] as TextPreset);
    this.#stage = h("div", { class: "kvfx-stage", attrs: { "aria-hidden": "true" } });
    const tiles = h("div", { class: "kvfx-tiles" });
    for (const preset of TEXT_PRESETS) {
      const tile = h("button", {
        class: "kvfx-tile",
        type: "button",
        text: preset.name,
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
      tiles.append(tile);
    }
    const speed = numberField("Speed", typeof animate["speed"] === "number" ? animate["speed"] : 1, { min: 0.1, max: 10, step: 0.25, unit: "×" });
    this.#speed = speed.input;
    speed.root.classList.add("kvfx-field--narrow");
    this.#speed.addEventListener("change", () => {
      session.setToolParams("textAnimate", { speed: Number(this.#speed.value) || 1 });
      this.#play();
    });
    const animateSection = this.#section("text.animate", "Animate", "from the playhead");
    animateSection.body.append(
      this.#stage,
      tiles,
      row(
        speed.root,
        this.#buttons.button("kvfx.text.animate", {
          label: "Animate Text",
          icon: "text-animate",
          variant: "wide",
          className: "kvfx-primary",
          params: () => ({ preset: this.#preset.id, speed: Number(this.#speed.value) || 1 }),
        }),
      ),
    );

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

  // --- live preview ---------------------------------------------------------

  #highlightPreset(): void {
    for (const [id, tile] of this.#presetTiles) toggleClass(tile, "kvfx-tile--on", id === this.#preset.id);
  }

  #play(preset: TextPreset = this.#preset): void {
    for (const animation of this.#animations) animation.cancel();
    this.#animations = [];
    if (this.#loopTimer !== undefined) clearTimeout(this.#loopTimer);
    if (!this.root.isConnected) return;

    clear(this.#stage);
    const sample = (this.#content.value.trim() || "Your title").slice(0, MAX_PREVIEW_CHARS);
    const chars = Array.from(sample).map((ch) => h("span", { class: "kvfx-stage__char", text: ch === " " ? " " : ch }));
    this.#stage.append(...chars);

    const speed = Math.max(MIN_SPEED, Number(this.#speed.value) || 1);
    const totalMs = (preset.duration / speed) * MS;
    const stagger = totalMs / Math.max(1, chars.length);
    const charMs = preset.smoothness === 0 ? SNAP_MS : Math.max(MIN_CHAR_MS, totalMs * SMOOTH_SHARE);
    const from = keyframeFor(preset.from);
    const to = keyframeFor({});
    chars.forEach((node, i) => {
      this.#animations.push(
        node.animate([from, to], { duration: charMs, delay: i * stagger, fill: "both", easing: "cubic-bezier(0.25, 1, 0.5, 1)" }),
      );
    });
    this.#loopTimer = setTimeout(() => this.#play(preset), totalMs + charMs + PREVIEW_PAUSE_MS);
  }

  shown(): void {
    this.#play();
  }

  update(state: SessionState, availability: Availability): void {
    for (const section of this.#sections) section.update(state);
    this.#buttons.update(state, availability);
  }
}
