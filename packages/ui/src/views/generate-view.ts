import { type CounterOptions, DEFAULT_COUNTER, easeAt, formatCounter, normalizeBezier } from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { CommandButtons, Section, colorField, hint, numberField, row, selectField, textField } from "../ui/controls.js";
import { h, setText, toggleClass } from "../ui/dom.js";
import { buildUiKitSections } from "./ui-kit-sections.js";
import { buildUiMotionSections } from "./ui-motion-sections.js";

/**
 * GENERATE: rigs built in one undo step.
 *
 *   Number Counter — a text layer counting between two numbers, eased.
 *   3D Carousel    — the selected layers (or copies of one) on a spinning ring.
 *   3D Extrude     — depth from stacked, parented slices.
 *   UI Motion      — staggered reveals, a clicking cursor, a focus carousel
 *                    and animated backdrops, for interface promos.
 */

const COUNTER_PREVIEW_MS = 1800;
const COUNTER_PAUSE_MS = 700;

/** Generator groups, for the chips at the top of the tab. */
const FILTERS: readonly (readonly [string, string])[] = [
  ["all", "All"],
  ["ui", "UI Motion"],
  ["scene", "Scenes"],
  ["build", "Builders"],
];
const GROUP_ORDER = ["ui", "scene", "build"];
const SECTION_GROUP: Readonly<Record<string, string>> = {
  "gen.uistagger": "ui",
  "gen.cursor": "ui",
  "gen.hover": "ui",
  "gen.cardcarousel": "ui",
  "gen.inputbar": "ui",
  "gen.backdrop": "scene",
  "gen.dotpulse": "scene",
  "gen.glass": "scene",
  "gen.wipe": "scene",
  "gen.codeglyphs": "scene",
};

/** The tools' opening values. */
const CAROUSEL = { cards: 8, radius: 600 } as const;
const EXTRUDE = { slices: 16, depth: 40 } as const;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export class GenerateView implements View {
  readonly id = "generate";
  readonly label = "Generate";
  readonly icon = "tab-gen";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #buttons: CommandButtons;
  readonly #sections: Section[] = [];
  readonly #counterPreview: HTMLElement;
  readonly #readCounter: () => CounterOptions;
  #animating = false;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);
    const session = panel.session;

    // --- counter ------------------------------------------------------------
    const c = session.toolParams("counter");
    const from = numberField("From", num(c["from"], DEFAULT_COUNTER.from), { step: 1 });
    const to = numberField("To", num(c["to"], DEFAULT_COUNTER.to), { step: 1 });
    const decimals = numberField("Decimals", num(c["decimals"], 0), { min: 0, max: 6, step: 1 });
    const duration = numberField("Time", num(c["duration"], DEFAULT_COUNTER.duration), { min: 0.1, step: 0.5, unit: "s" });
    const prefix = textField("Prefix", str(c["prefix"], ""), undefined, "$");
    const suffix = textField("Suffix", str(c["suffix"], ""), undefined, "%");
    const separator = selectField(
      "Groups",
      [
        { value: ",", label: "1,000" },
        { value: ".", label: "1.000" },
        { value: " ", label: "1 000" },
        { value: "", label: "1000" },
      ],
      str(c["separator"], ","),
    );
    const decimalMark = selectField(
      "Point",
      [
        { value: ".", label: "0.5" },
        { value: ",", label: "0,5" },
      ],
      str(c["decimalMark"], "."),
    );
    this.#readCounter = (): CounterOptions => ({
      from: Number(from.input.value) || 0,
      to: Number(to.input.value) || 0,
      decimals: Number(decimals.input.value) || 0,
      duration: Number(duration.input.value) || DEFAULT_COUNTER.duration,
      prefix: prefix.input.value,
      suffix: suffix.input.value,
      separator: separator.select.value,
      decimalMark: decimalMark.select.value,
    });
    this.#counterPreview = h("div", { class: "kvfx-counter", attrs: { "aria-live": "off" } });

    const counter = this.#section("gen.counter", "Number Counter");
    counter.body.append(
      this.#counterPreview,
      row(from.root, to.root),
      row(decimals.root, duration.root),
      row(prefix.root, suffix.root),
      row(separator.root, decimalMark.root),
      this.#buttons.button("kvfx.rig.counter", {
        label: "Create Counter",
        icon: "counter",
        variant: "wide",
        className: "kvfx-primary",
        params: () => {
          const options = this.#readCounter();
          const params = { ...options, bezier: [...session.state.settings.ui.ease] };
          session.setToolParams("counter", { ...options });
          return params;
        },
      }),
      hint("Uses the Ease tab's curve. Retime it by moving the two keyframes on the layer's KVFX Counter slider."),
    );

    // --- carousel -----------------------------------------------------------
    const cr = session.toolParams("carousel");
    const cards = numberField("Cards", num(cr["count"], CAROUSEL.cards), { min: 2, max: 36, step: 1 });
    const radius = numberField("Radius", num(cr["radius"], CAROUSEL.radius), { min: 10, step: 10, unit: "px" });
    const carousel = this.#section("gen.carousel", "3D Carousel");
    carousel.body.append(
      row(cards.root, radius.root),
      this.#buttons.button("kvfx.rig.carousel", {
        label: "Build Carousel",
        icon: "carousel",
        variant: "wide",
        params: () => {
          const params = { count: Number(cards.input.value) || CAROUSEL.cards, radius: Number(radius.input.value) || CAROUSEL.radius };
          session.setToolParams("carousel", params);
          return params;
        },
      }),
      hint("Select several layers to use them as the cards, or one to copy. Spin and Radius live on the KVFX Carousel null."),
    );

    // --- extrude --------------------------------------------------------------
    const ex = session.toolParams("extrude");
    const slices = numberField("Slices", num(ex["slices"], EXTRUDE.slices), { min: 2, max: 60, step: 1 });
    const depth = numberField("Depth", num(ex["depth"], EXTRUDE.depth), { min: 0, step: 5, unit: "px" });
    const side = colorField("Side", str(ex["color"], "#59331a"));
    const extrude = this.#section("gen.extrude", "3D Extrude");
    extrude.body.append(
      row(slices.root, depth.root, side.root),
      this.#buttons.button("kvfx.rig.extrude", {
        label: "Extrude",
        icon: "extrude",
        variant: "wide",
        params: () => {
          const params = { slices: Number(slices.input.value) || EXTRUDE.slices, depth: Number(depth.input.value) || 0, color: side.input.value };
          session.setToolParams("extrude", params);
          return params;
        },
      }),
      hint("Works best on text, shapes and logos. Change the depth later with the KVFX Extrude slider on the face layer."),
    );

    const make = (id: string, title: string, hintText?: string): Section => this.#section(id, title, hintText);
    buildUiMotionSections(panel, this.#buttons, make);
    buildUiKitSections(panel, this.#buttons, make);

    // A long tab: chips narrow it to one kind of generator at a time.
    this.#filters = h("div", { class: "kvfx-filters kvfx-filters--tab", attrs: { role: "tablist", "aria-label": "Generator groups" } });
    for (const [id, label] of FILTERS) {
      this.#filters.append(
        h("button", {
          class: "kvfx-filter",
          type: "button",
          text: label,
          attrs: { "data-filter": id },
          on: {
            click: () => {
              session.setToolParams("generate", { filter: id });
              this.#applyFilter();
            },
          },
        }),
      );
    }
    // Sections in their groups' order, so a filtered tab reads top-down.
    const ordered = [...this.#sections].sort((a, b) => GROUP_ORDER.indexOf(this.#group(a)) - GROUP_ORDER.indexOf(this.#group(b)));
    this.root = h("div", { class: "kvfx-tab" }, this.#filters, ...ordered.map((s) => s.root));
    this.#applyFilter();
  }

  readonly #filters: HTMLElement;
  readonly #groups = new Map<Section, string>();

  #group(section: Section): string {
    return this.#groups.get(section) ?? "build";
  }

  #applyFilter(): void {
    const value = this.#panel.session.toolParams("generate")["filter"];
    const filter = typeof value === "string" && FILTERS.some(([id]) => id === value) ? value : "all";
    for (const section of this.#sections) section.root.hidden = filter !== "all" && this.#group(section) !== filter;
    for (const button of Array.from(this.#filters.querySelectorAll<HTMLButtonElement>(".kvfx-filter"))) {
      toggleClass(button, "kvfx-filter--on", button.dataset["filter"] === filter);
    }
  }

  #section(id: string, title: string, hintText?: string): Section {
    const section = new Section(this.#panel, id, title, hintText);
    this.#sections.push(section);
    this.#groups.set(section, SECTION_GROUP[id] ?? "build");
    return section;
  }

  #animateCounter(): void {
    if (this.#animating) return;
    this.#animating = true;
    const start = performance.now();
    const frame = (now: number): void => {
      if (!this.root.isConnected || document.hidden) {
        this.#animating = false;
        return;
      }
      const cycle = (now - start) % (COUNTER_PREVIEW_MS + COUNTER_PAUSE_MS);
      const t = Math.min(1, cycle / COUNTER_PREVIEW_MS);
      const ease = normalizeBezier(this.#panel.session.state.settings.ui.ease);
      setText(this.#counterPreview, formatCounter(this.#readCounter(), easeAt(ease, t)));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  shown(): void {
    this.#animateCounter();
  }

  update(state: SessionState, availability: Availability): void {
    for (const section of this.#sections) section.update(state);
    this.#buttons.update(state, availability);
  }
}
