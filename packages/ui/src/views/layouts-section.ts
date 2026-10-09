import {
  type JsonObject,
  type JsonValue,
  LAYOUT_CATEGORIES,
  LAYOUT_TEMPLATES,
  LAYOUT_THEMES,
  type LayoutElement,
  type LayoutTemplate,
  REVEAL_STYLES,
  hexToRgb,
  resolveColor,
  rgbToHex,
} from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import {
  type CommandButtons,
  type Section,
  colorField,
  hint,
  numberField,
  row,
  segmented,
  selectField,
  toggles,
} from "../ui/controls.js";
import { clear, h, toggleClass } from "../ui/dom.js";

/**
 * Generate ▸ Layouts: a gallery of interface scenes, each drawn as a small
 * thumbnail from the very data the builder uses, with its words editable.
 */

/* eslint-disable no-magic-numbers -- thumbnail proportions and opening values */

const SVG = "http://www.w3.org/2000/svg";
const THUMB = { w: 120, h: 68 } as const;

type MakeSection = (id: string, title: string, hintText?: string) => Section;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A thumbnail of a template: its cards, circles and bars, with text as soft lines. */
export function layoutThumbnail(template: LayoutTemplate, themeId: "dark" | "light", accentHex: string): SVGElement {
  const theme = LAYOUT_THEMES.find((t) => t.id === themeId) ?? LAYOUT_THEMES[0];
  const accent = hexToRgb(accentHex) ?? [1, 0.56, 0.25];
  const [w, h] = template.size;
  const k = Math.min((THUMB.w * 0.9) / w, (THUMB.h * 0.9) / h);
  const root = svg("svg", { viewBox: `0 0 ${String(THUMB.w)} ${String(THUMB.h)}`, class: "kvfx-thumb__svg", "aria-hidden": "true" });
  if (theme === undefined) return root;
  const fill = (role: Parameters<typeof resolveColor>[0]): string => rgbToHex(resolveColor(role, theme, accent));
  const X = (x: number): number => THUMB.w / 2 + x * k;
  const Y = (y: number): number => THUMB.h / 2 + y * k;
  const elements: LayoutElement[] = template.build((key) => template.fields.find((f) => f.key === key)?.value ?? "");
  for (const e of elements) {
    switch (e.kind) {
      case "card": {
        const rect = svg("rect", { x: X(e.x - e.w / 2), y: Y(e.y - e.h / 2), width: Math.max(0.6, e.w * k), height: Math.max(0.6, e.h * k), rx: e.radius * k, fill: fill(e.fill) });
        if (e.stroke !== undefined) {
          rect.setAttribute("stroke", fill(e.stroke));
          rect.setAttribute("stroke-width", "0.5");
        }
        if (e.rotation !== undefined) rect.setAttribute("transform", `rotate(${String(e.rotation)} ${String(X(e.x))} ${String(Y(e.y))})`);
        root.append(rect);
        break;
      }
      case "circle":
        root.append(svg("circle", { cx: X(e.x), cy: Y(e.y), r: (e.d * k) / 2, fill: fill(e.fill) }));
        break;
      case "bar":
        root.append(svg("rect", { x: X(e.x - e.w / 2), y: Y(e.y - e.h), width: e.w * k, height: e.h * k, rx: Math.min(e.radius, e.w / 2) * k, fill: fill(e.fill) }));
        break;
      case "ring": {
        const r = (e.d * k) / 2;
        root.append(svg("circle", { cx: X(e.x), cy: Y(e.y), r, fill: "none", stroke: fill(e.track), "stroke-width": e.width * k }));
        const length = 2 * Math.PI * r;
        root.append(
          svg("circle", {
            cx: X(e.x),
            cy: Y(e.y),
            r,
            fill: "none",
            stroke: fill(e.color),
            "stroke-width": e.width * k,
            "stroke-dasharray": `${String(length * e.progress)} ${String(length)}`,
            transform: `rotate(-90 ${String(X(e.x))} ${String(Y(e.y))})`,
          }),
        );
        break;
      }
      case "line":
        root.append(svg("polyline", { points: e.points.map(([x, y]) => `${String(X(x))},${String(Y(y))}`).join(" "), fill: "none", stroke: fill(e.color), "stroke-width": Math.max(0.8, e.width * k), "stroke-linejoin": "round" }));
        break;
      case "dots":
        for (const offset of [-1.6, 0, 1.6]) root.append(svg("circle", { cx: X(e.x + offset * e.d), cy: Y(e.y), r: (e.d * k) / 2, fill: fill(e.color) }));
        break;
      case "text": {
        const lines = e.text.split("\r");
        const width = Math.max(...lines.map((line) => line.length)) * e.size * 0.5 * k;
        lines.forEach((_line, i) => {
          const left = e.align === "center" ? X(e.x) - width / 2 : e.align === "right" ? X(e.x) - width : X(e.x);
          root.append(svg("rect", { x: left, y: Y(e.y + i * e.size * 1.2) - e.size * k * 0.7, width: Math.max(1, width), height: Math.max(0.8, e.size * k * 0.55), rx: 0.5, fill: fill(e.color), opacity: 0.85 }));
        });
        break;
      }
    }
  }
  return root;
}

export function buildLayoutsSection(panel: Panel, buttons: CommandButtons, section: MakeSection): void {
  const session = panel.session;
  const p = session.toolParams("layout");
  const first = LAYOUT_TEMPLATES[0];
  if (first === undefined) return;
  let current: LayoutTemplate = LAYOUT_TEMPLATES.find((t) => t.id === p["template"]) ?? first;
  let theme: "dark" | "light" = p["theme"] === "light" ? "light" : "dark";
  let category = "All";

  const gallery = h("div", { class: "kvfx-thumbs" });
  const fields = h("div", { class: "kvfx-stack" });
  const tiles = new Map<string, HTMLButtonElement>();
  const accent = colorField("Accent", typeof p["accent"] === "string" ? p["accent"] : "#ff8f3f", () => paintThumbs());

  const savedContent = (): Record<string, JsonValue> => {
    const all = session.toolParams("layout")["content"];
    const mine = typeof all === "object" && all !== null && !Array.isArray(all) ? all[current.id] : undefined;
    return typeof mine === "object" && mine !== null && !Array.isArray(mine) ? { ...mine } : {};
  };
  const inputs = new Map<string, HTMLInputElement>();

  const renderFields = (): void => {
    clear(fields);
    inputs.clear();
    const saved = savedContent();
    for (const field of current.fields) {
      const input = h("input", { class: "kvfx-input", type: "text", attrs: { "aria-label": field.label, spellcheck: "false" } });
      const remembered = saved[field.key];
      input.value = typeof remembered === "string" ? remembered : field.value;
      inputs.set(field.key, input);
      fields.append(h("label", { class: "kvfx-field" }, h("span", { class: "kvfx-field__label", text: field.label }), input));
    }
  };

  const paintThumbs = (): void => {
    for (const template of LAYOUT_TEMPLATES) {
      const tile = tiles.get(template.id);
      if (tile === undefined) continue;
      const holder = tile.querySelector(".kvfx-thumb__art");
      if (holder !== null) {
        clear(holder);
        holder.append(layoutThumbnail(template, theme, accent.input.value));
      }
      toggleClass(tile, "kvfx-thumb--on", template.id === current.id);
      tile.hidden = category !== "All" && template.category !== category;
    }
  };

  for (const template of LAYOUT_TEMPLATES) {
    const tile = h(
      "button",
      {
        class: "kvfx-thumb",
        type: "button",
        title: `${template.name} — ${template.category}`,
        on: {
          click: () => {
            current = template;
            session.setToolParams("layout", { template: template.id });
            renderFields();
            paintThumbs();
          },
        },
      },
      h("span", { class: "kvfx-thumb__art" }),
      h("span", { class: "kvfx-thumb__name", text: template.name }),
    );
    tiles.set(template.id, tile);
    gallery.append(tile);
  }

  const chips = h("div", { class: "kvfx-filters" });
  for (const name of ["All", ...LAYOUT_CATEGORIES]) {
    chips.append(
      h("button", {
        class: `kvfx-filter${name === category ? " kvfx-filter--on" : ""}`,
        type: "button",
        text: name,
        attrs: { "data-filter": name },
        on: {
          click: () => {
            category = name;
            for (const chip of Array.from(chips.querySelectorAll<HTMLButtonElement>(".kvfx-filter"))) {
              toggleClass(chip, "kvfx-filter--on", chip.dataset["filter"] === name);
            }
            paintThumbs();
          },
        },
      }),
    );
  }

  const themeSeg = segmented(
    [
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
    theme,
    (value) => {
      theme = value;
      themeSeg.set(value);
      paintThumbs();
    },
  );
  const roundness = numberField("Corners", typeof p["roundness"] === "number" ? p["roundness"] : 100, { min: 0, max: 300, step: 10, unit: "%" });
  const reveal = selectField(
    "Reveal",
    [{ value: "auto", label: "Designed" }, ...REVEAL_STYLES.map((s) => ({ value: s.id, label: s.label })), { value: "none", label: "None" }],
    typeof p["reveal"] === "string" ? p["reveal"] : "auto",
  );
  const stagger = numberField("Stagger", typeof p["stagger"] === "number" ? p["stagger"] : 5, { min: 0, step: 1, unit: "fr" });
  const duration = numberField("Each", typeof p["duration"] === "number" ? p["duration"] : 16, { min: 1, step: 1, unit: "fr" });
  const options = toggles([{ key: "shadows", label: "Shadows" }], { shadows: p["shadows"] !== false }, () => undefined);

  section("gen.layouts", "Layouts", `${String(LAYOUT_TEMPLATES.length)} interface scenes`).body.append(
    chips,
    gallery,
    fields,
    row(themeSeg.root, accent.root, roundness.root),
    row(reveal.root, stagger.root, duration.root),
    options.root,
    buttons.button("kvfx.rig.layout", {
      label: "Build Layout",
      icon: "layout",
      variant: "wide",
      className: "kvfx-primary",
      params: () => {
        const content: Record<string, JsonValue> = {};
        for (const [key, input] of inputs) content[key] = input.value;
        const allContent = session.toolParams("layout")["content"];
        const previous = typeof allContent === "object" && allContent !== null && !Array.isArray(allContent) ? allContent : {};
        const params: JsonObject = {
          template: current.id,
          theme,
          accent: accent.input.value,
          roundness: Number(roundness.input.value) || 0,
          reveal: reveal.select.value,
          stagger: Number(stagger.input.value) || 0,
          duration: Number(duration.input.value) || 16,
          shadows: options.get("shadows"),
        };
        session.setToolParams("layout", { ...params, content: { ...previous, [current.id]: content } });
        return { ...params, content, bezier: [...session.state.settings.ui.ease] };
      },
    }),
    hint("Lists are comma-separated. Everything lands on one KVFX Layout null — scale or move that to place it. Each part is an ordinary layer you can restyle."),
  );
  renderFields();
  paintThumbs();
}
