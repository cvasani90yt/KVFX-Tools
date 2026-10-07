import {
  BEZIER_Y_MAX,
  BEZIER_Y_MIN,
  type Bezier,
  DEFAULT_BOUNCE,
  DEFAULT_ELASTIC,
  EASE_PRESETS,
  type EasePreset,
  easeAt,
  formatBezier,
  matchPreset,
  normalizeBezier,
  parseBezier,
  reverseBezier,
} from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { CommandButtons, Section, actionButton, numberField, pillGrid, row } from "../ui/controls.js";
import { clear, h, setText, toggleClass } from "../ui/dom.js";

/**
 * EASE: a curve editor that writes real After Effects easing, plus keyframe
 * interpolation and expression-driven motion.
 *
 * The curve is a cubic bezier like CSS's; dragging a handle changes it, and
 * Apply converts it to speed and influence on the selected keyframes (the
 * maths lives in the host op). "Read" does the reverse, so the editor can show
 * what a keyframe already has.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Editor geometry, in viewBox units. The unit square is 140 wide, with room for overshoot. */
const VIEW_W = 200;
const VIEW_H = 230;
const PLOT_X = 30;
const PLOT_SIZE = 140;
const PLOT_BOTTOM = 185;
const HANDLE_R = 7;
const PREVIEW_MS = 1400;
const PAUSE_MS = 350;
const THUMB = 34;
const GRID_DIVISIONS = 4;
const PERCENT = 100;
const WIGGLE = { frequency: 2, amplitude: 20 } as const;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const toX = (x: number): number => PLOT_X + x * PLOT_SIZE;
const toY = (y: number): number => PLOT_BOTTOM - y * PLOT_SIZE;

function curvePath(b: Bezier, size?: number): string {
  if (size !== undefined) {
    // Thumbnails: the unit square fills the box, overshoot simply clips.
    const pad = 3;
    const s = size - pad * 2;
    const px = (x: number): number => pad + x * s;
    const py = (y: number): number => size - pad - y * s;
    return `M${px(0)} ${py(0)} C${px(b[0])} ${py(b[1])} ${px(b[2])} ${py(b[3])} ${px(1)} ${py(1)}`;
  }
  return `M${toX(0)} ${toY(0)} C${toX(b[0])} ${toY(b[1])} ${toX(b[2])} ${toY(b[3])} ${toX(1)} ${toY(1)}`;
}

export class EaseView implements View {
  readonly id = "ease";
  readonly label = "Ease";
  readonly icon = "tab-ease";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #buttons: CommandButtons;
  readonly #sections: Section[] = [];
  readonly #editor: SVGSVGElement;
  readonly #curve: SVGPathElement;
  readonly #arms: [SVGLineElement, SVGLineElement];
  readonly #handles: [SVGCircleElement, SVGCircleElement];
  readonly #values: HTMLInputElement;
  readonly #presetName: HTMLElement;
  readonly #dot: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #presetGrid: HTMLElement;
  readonly #customGrid: HTMLElement;
  readonly #saveName: HTMLInputElement;
  #bezier: Bezier;
  #dragging: 0 | 1 | undefined;
  #animating = false;
  #customKey = "";

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);
    const session = panel.session;
    this.#bezier = normalizeBezier(session.state.settings.ui.ease);

    // --- editor ------------------------------------------------------------
    this.#editor = svg("svg", { viewBox: `0 0 ${String(VIEW_W)} ${String(VIEW_H)}`, class: "kvfx-curve" });
    const grid = svg("g", { class: "kvfx-curve__grid" });
    for (let i = 0; i <= GRID_DIVISIONS; i += 1) {
      const t = i / GRID_DIVISIONS;
      grid.append(
        svg("line", { x1: String(toX(t)), y1: String(toY(0)), x2: String(toX(t)), y2: String(toY(1)) }),
        svg("line", { x1: String(toX(0)), y1: String(toY(t)), x2: String(toX(1)), y2: String(toY(t)) }),
      );
    }
    grid.append(svg("rect", { x: String(toX(0)), y: String(toY(1)), width: String(PLOT_SIZE), height: String(PLOT_SIZE), class: "kvfx-curve__frame" }));
    const linear = svg("line", { x1: String(toX(0)), y1: String(toY(0)), x2: String(toX(1)), y2: String(toY(1)), class: "kvfx-curve__linear" });
    this.#arms = [svg("line", { class: "kvfx-curve__arm" }), svg("line", { class: "kvfx-curve__arm" })];
    this.#curve = svg("path", { class: "kvfx-curve__path" });
    this.#handles = [
      svg("circle", { r: String(HANDLE_R), class: "kvfx-curve__handle" }),
      svg("circle", { r: String(HANDLE_R), class: "kvfx-curve__handle" }),
    ];
    const ends = [svg("circle", { cx: String(toX(0)), cy: String(toY(0)), r: "3.5", class: "kvfx-curve__end" }), svg("circle", { cx: String(toX(1)), cy: String(toY(1)), r: "3.5", class: "kvfx-curve__end" })];
    this.#editor.append(grid, linear, ...this.#arms, this.#curve, ...ends, ...this.#handles);
    this.#handles.forEach((handle, index) => {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.#dragging = index as 0 | 1;
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", (event) => {
        if (this.#dragging === index) this.#dragTo(event);
      });
      handle.addEventListener("pointerup", () => this.#endDrag());
      handle.addEventListener("pointercancel", () => this.#endDrag());
    });

    this.#values = h("input", {
      class: "kvfx-input kvfx-input--mono",
      type: "text",
      attrs: { spellcheck: "false", "aria-label": "Curve values", title: "x1, y1, x2, y2 — paste cubic-bezier() values here" },
      on: {
        change: () => {
          const parsed = parseBezier(this.#values.value);
          if (parsed === undefined) {
            this.#values.value = formatBezier(this.#bezier);
            session.report("Curve", false, "Enter four numbers, like 0.25, 0.1, 0.25, 1.");
            return;
          }
          this.#set(parsed, true);
        },
      },
    });
    this.#presetName = h("span", { class: "kvfx-curve__name" });
    this.#dot = h("span", { class: "kvfx-preview__dot" });
    this.#fill = h("span", { class: "kvfx-preview__fill" });
    const preview = h("div", { class: "kvfx-preview", title: "Live preview of the curve" }, this.#fill, this.#dot);

    const editor = this.#section("ease.curve", "Curve");
    editor.body.append(
      h("div", { class: "kvfx-curvebox" }, this.#editor),
      preview,
      row(this.#presetName, this.#values),
      h(
        "div",
        { class: "kvfx-actions" },
        this.#buttons.button("kvfx.keys.ease", {
          label: "Apply to Keys",
          icon: "ease",
          variant: "wide",
          className: "kvfx-primary",
          params: () => ({ bezier: [...this.#bezier] }),
        }),
        actionButton("Read", () => void this.#read(), { icon: "refresh", variant: "tool", title: "Read the curve from the selected keyframes" }),
        actionButton("Flip", () => this.#set(reverseBezier(this.#bezier), true), { icon: "reverse", variant: "tool", title: "Mirror the curve: ease-in ↔ ease-out" }),
      ),
    );

    // --- presets ------------------------------------------------------------
    this.#presetGrid = h("div", { class: "kvfx-presets" });
    for (const group of ["Basic", "In", "Out", "In-Out"] as const) {
      this.#presetGrid.append(h("div", { class: "kvfx-presets__group", text: group }));
      for (const preset of EASE_PRESETS.filter((p) => p.group === group)) this.#presetGrid.append(this.#presetTile(preset));
    }
    this.#customGrid = h("div", { class: "kvfx-presets" });
    this.#saveName = h("input", { class: "kvfx-input", type: "text", attrs: { placeholder: "Name this curve", "aria-label": "Curve name", spellcheck: "false" } });
    const presets = this.#section("ease.presets", "Presets");
    presets.body.append(
      this.#presetGrid,
      h("div", { class: "kvfx-subhead", text: "Saved" }),
      this.#customGrid,
      row(
        this.#saveName,
        actionButton("Save", () => {
          const name = this.#saveName.value.trim();
          if (name.length === 0) {
            session.report("Save curve", false, "Give the curve a name first.");
            return;
          }
          session.saveEase(name, this.#bezier);
          this.#saveName.value = "";
          session.report("Save curve", true, `Saved “${name}”`);
        }, { icon: "plus" }),
      ),
    );

    // --- keyframes ----------------------------------------------------------
    const keys = this.#section("ease.keys", "Keyframes");
    keys.body.append(
      pillGrid(
        this.#buttons.button("kvfx.keys.linear", { label: "Linear", icon: "key-linear" }),
        this.#buttons.button("kvfx.keys.bezier", { label: "Bezier", icon: "key-bezier" }),
        this.#buttons.button("kvfx.keys.hold", { label: "Hold", icon: "key-hold" }),
        this.#buttons.button("kvfx.keys.reverse", { label: "Reverse", icon: "reverse" }),
      ),
    );

    // --- motion -------------------------------------------------------------
    const elastic = session.toolParams("elastic");
    const amp = numberField("Amp", num(elastic["amplitude"], DEFAULT_ELASTIC.amplitude), { step: 0.01, min: 0, max: 1 });
    const freq = numberField("Freq", num(elastic["frequency"], DEFAULT_ELASTIC.frequency), { step: 0.5, min: 0.1, max: 20 });
    const decay = numberField("Decay", num(elastic["decay"], DEFAULT_ELASTIC.decay), { step: 0.5, min: 0.1, max: 50 });
    const bounce = session.toolParams("bounce");
    const elasticity = numberField("Elastic", num(bounce["elasticity"], DEFAULT_BOUNCE.elasticity), { step: 0.05, min: 0, max: 0.95 });
    const gravity = numberField("Gravity", num(bounce["gravity"], DEFAULT_BOUNCE.gravity), { step: 500, min: 100, max: 50000 });
    const wiggle = session.toolParams("wiggle");
    const wFreq = numberField("Freq", num(wiggle["frequency"], WIGGLE.frequency), { step: 0.5, min: 0 });
    const wAmp = numberField("Amount", num(wiggle["amplitude"], WIGGLE.amplitude), { step: 1, min: 0 });

    const motion = this.#section("ease.motion", "Motion", "selected properties");
    motion.body.append(
      row(amp.root, freq.root, decay.root),
      this.#buttons.button("kvfx.keys.elastic", {
        label: "Add Elastic",
        icon: "elastic",
        variant: "wide",
        params: () => {
          const params = { amplitude: Number(amp.input.value), frequency: Number(freq.input.value), decay: Number(decay.input.value) };
          session.setToolParams("elastic", params);
          return params;
        },
      }),
      row(elasticity.root, gravity.root),
      this.#buttons.button("kvfx.keys.bounce", {
        label: "Add Bounce",
        icon: "bounce",
        variant: "wide",
        params: () => {
          const params = { elasticity: Number(elasticity.input.value), gravity: Number(gravity.input.value) };
          session.setToolParams("bounce", params);
          return params;
        },
      }),
      row(wFreq.root, wAmp.root),
      this.#buttons.button("kvfx.keys.wiggle", {
        label: "Add Wiggle",
        icon: "wiggle",
        variant: "wide",
        params: () => {
          const params = { frequency: Number(wFreq.input.value), amplitude: Number(wAmp.input.value) };
          session.setToolParams("wiggle", params);
          return params;
        },
      }),
      pillGrid(
        this.#buttons.button("kvfx.keys.loopcycle", { label: "Loop", icon: "loop" }),
        this.#buttons.button("kvfx.keys.looppingpong", { label: "Ping-Pong", icon: "loop" }),
        this.#buttons.button("kvfx.keys.loopcontinue", { label: "Continue", icon: "loop" }),
        this.#buttons.button("kvfx.keys.clearexpressions", { label: "Clear Expr", icon: "clear" }),
      ),
    );

    this.root = h("div", { class: "kvfx-tab" }, ...this.#sections.map((s) => s.root));
    this.#draw();
  }

  #section(id: string, title: string, hint?: string): Section {
    const section = new Section(this.#panel, id, title, hint);
    this.#sections.push(section);
    return section;
  }

  #presetTile(preset: EasePreset | { name: string; bezier: Bezier }, onDelete?: () => void): HTMLElement {
    const thumb = svg("svg", { viewBox: `0 0 ${String(THUMB)} ${String(THUMB)}`, class: "kvfx-thumb" });
    thumb.append(svg("path", { d: curvePath(preset.bezier, THUMB) }));
    const tile = h(
      "button",
      {
        class: "kvfx-preset",
        type: "button",
        title: `${preset.name} — ${formatBezier(preset.bezier)}`,
        on: { click: () => this.#set(preset.bezier, true) },
      },
      thumb,
      h("span", { text: preset.name }),
    );
    tile.dataset["bezier"] = formatBezier(preset.bezier);
    if (onDelete === undefined) return tile;
    const remove = h(
      "button",
      {
        class: "kvfx-preset__remove",
        type: "button",
        title: `Delete “${preset.name}”`,
        attrs: { "aria-label": `Delete ${preset.name}` },
        on: { click: (event) => {
          event.stopPropagation();
          onDelete();
        } },
      },
      createIcon("close", IconSize.tiny),
    );
    return h("div", { class: "kvfx-preset-wrap" }, tile, remove);
  }

  #dragTo(event: PointerEvent): void {
    const index = this.#dragging;
    if (index === undefined) return;
    const rect = this.#editor.getBoundingClientRect();
    const scale = VIEW_W / rect.width;
    const vx = (event.clientX - rect.left) * scale;
    const vy = (event.clientY - rect.top) * scale;
    const x = Math.min(1, Math.max(0, (vx - PLOT_X) / PLOT_SIZE));
    const y = Math.min(BEZIER_Y_MAX, Math.max(BEZIER_Y_MIN, (PLOT_BOTTOM - vy) / PLOT_SIZE));
    const next = [...this.#bezier];
    next[index * 2] = x;
    next[index * 2 + 1] = y;
    this.#set(normalizeBezier(next), false);
  }

  #endDrag(): void {
    if (this.#dragging === undefined) return;
    this.#dragging = undefined;
    this.#panel.session.setUi("ease", [...this.#bezier] as unknown as [number, number, number, number]);
  }

  #set(bezier: Bezier, persist: boolean): void {
    this.#bezier = bezier;
    this.#draw();
    if (persist) this.#panel.session.setUi("ease", [...bezier] as unknown as [number, number, number, number]);
  }

  async #read(): Promise<void> {
    const result = await this.#panel.session.query("kvfx.op.keys.readEase");
    if (!result.ok) {
      this.#panel.session.report("Read curve", false, result.message);
      return;
    }
    const value = result.value as { bezier?: unknown; property?: unknown } | null;
    const bezier = Array.isArray(value?.bezier) ? (value.bezier as number[]) : undefined;
    if (bezier === undefined) {
      this.#panel.session.report("Read curve", false, "Select two or more keyframes on a property.");
      return;
    }
    this.#set(normalizeBezier(bezier), true);
    this.#panel.session.report("Read curve", true, `From ${typeof value?.property === "string" ? value.property : "the selection"}`);
  }

  #draw(): void {
    const [x1, y1, x2, y2] = this.#bezier;
    this.#curve.setAttribute("d", curvePath(this.#bezier));
    const points: [number, number][] = [
      [toX(x1), toY(y1)],
      [toX(x2), toY(y2)],
    ];
    const anchors: [number, number][] = [
      [toX(0), toY(0)],
      [toX(1), toY(1)],
    ];
    for (let i = 0; i < 2; i += 1) {
      const [px, py] = points[i] ?? [0, 0];
      const [ax, ay] = anchors[i] ?? [0, 0];
      this.#handles[i]?.setAttribute("cx", String(px));
      this.#handles[i]?.setAttribute("cy", String(py));
      const arm = this.#arms[i];
      arm?.setAttribute("x1", String(ax));
      arm?.setAttribute("y1", String(ay));
      arm?.setAttribute("x2", String(px));
      arm?.setAttribute("y2", String(py));
    }
    if (document.activeElement !== this.#values) this.#values.value = formatBezier(this.#bezier);
    setText(this.#presetName, matchPreset(this.#bezier)?.name ?? "Custom");
    const current = formatBezier(this.#bezier);
    for (const tile of Array.from((this.root as HTMLElement | undefined)?.querySelectorAll<HTMLElement>(".kvfx-preset") ?? [])) {
      toggleClass(tile, "kvfx-preset--on", tile.dataset["bezier"] === current);
    }
  }

  #animate(): void {
    if (this.#animating) return;
    this.#animating = true;
    const start = performance.now();
    const frame = (now: number): void => {
      if (!this.root.isConnected || document.hidden) {
        this.#animating = false;
        return;
      }
      const cycle = (now - start) % (PREVIEW_MS + PAUSE_MS);
      const t = Math.min(1, cycle / PREVIEW_MS);
      const progress = easeAt(this.#bezier, t);
      const pct = `${(progress * PERCENT).toFixed(2)}%`;
      this.#dot.style.left = pct;
      this.#fill.style.width = `${(Math.min(1, Math.max(0, progress)) * PERCENT).toFixed(2)}%`;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  shown(): void {
    this.#animate();
  }

  update(state: SessionState, availability: Availability): void {
    for (const section of this.#sections) section.update(state);
    this.#buttons.update(state, availability);

    // The stored curve can change from elsewhere (reset); follow it unless mid-drag.
    const stored = normalizeBezier(state.settings.ui.ease);
    if (this.#dragging === undefined && formatBezier(stored) !== formatBezier(this.#bezier)) {
      this.#bezier = stored;
      this.#draw();
    }

    const key = state.settings.ui.customEases.map((e) => `${e.name}:${formatBezier(e.bezier)}`).join("|");
    if (key !== this.#customKey) {
      this.#customKey = key;
      clear(this.#customGrid);
      if (state.settings.ui.customEases.length === 0) {
        this.#customGrid.append(h("p", { class: "kvfx-hint", text: "Curves you save appear here." }));
      }
      for (const saved of state.settings.ui.customEases) {
        this.#customGrid.append(
          this.#presetTile({ name: saved.name, bezier: normalizeBezier(saved.bezier) }, () => this.#panel.session.deleteEase(saved.name)),
        );
      }
      this.#draw();
    }
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
