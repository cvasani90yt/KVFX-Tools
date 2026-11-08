import { hexToRgb, rgbToHex } from "@kvfx/core";
import { IconSize, createIcon } from "../components/icons.js";
import { h, setText, toggleClass } from "./dom.js";

/**
 * Colour fields with a picker drawn inside the panel.
 *
 * `<input type="color">` opens the platform's colour dialog. Inside After
 * Effects that dialog is a separate pop-up the panel does not own, so typing a
 * hex code into it hands the keystrokes to After Effects and the dialog
 * closes. This picker is ordinary panel markup instead: a saturation and
 * brightness square, a hue bar, a hex box that takes typing like any other
 * field, and a row of swatches. One popover is shared by every field, since
 * only one can be open at a time.
 */

/* eslint-disable no-magic-numbers -- colour maths and the popover's size are the content */

type Hsv = [number, number, number];

const POPOVER_W = 216;
const POPOVER_H = 252;
const EDGE = 6;
const RECENT_MAX = 6;

/** A few useful colours, then the ones used most recently in this session. */
const PALETTE = ["#ff8f3f", "#ffb36b", "#e3c44a", "#3fb950", "#5ec8b0", "#7fa8ff", "#a78bfa", "#f05c5c", "#ffffff", "#9aa0ab", "#2a2e37", "#000000"];
const recent: string[] = [];

/** "#rgb", "rgb", "#rrggbb" or "rrggbb" to "#rrggbb", or undefined. */
export function normalizeHex(text: string): string | undefined {
  const rgb = hexToRgb(text.trim());
  return rgb === undefined ? undefined : rgbToHex(rgb);
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max === 0 ? 0 : d / max, max];
}

function hsvToRgb([hue, s, v]: Hsv): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const hsvOf = (hex: string): Hsv => {
  const rgb = hexToRgb(hex) ?? [1, 1, 1];
  return rgbToHsv(rgb[0], rgb[1], rgb[2]);
};

class ColorPopover {
  readonly root: HTMLElement;
  readonly #sv: HTMLElement;
  readonly #svThumb: HTMLElement;
  readonly #hue: HTMLElement;
  readonly #hueThumb: HTMLElement;
  readonly #chip: HTMLElement;
  readonly #hex: HTMLInputElement;
  readonly #swatches: HTMLElement;
  #hsv: Hsv = [0, 0, 1];
  #original = "#ffffff";
  #anchor: HTMLElement | undefined;
  #onPick: ((hex: string) => void) | undefined;
  #onClose: (() => void) | undefined;

  constructor() {
    this.#svThumb = h("span", { class: "kvfx-cpick__thumb" });
    this.#sv = h("div", { class: "kvfx-cpick__sv", attrs: { "aria-label": "Saturation and brightness" } }, this.#svThumb);
    this.#hueThumb = h("span", { class: "kvfx-cpick__thumb kvfx-cpick__thumb--hue" });
    this.#hue = h("div", { class: "kvfx-cpick__hue", attrs: { "aria-label": "Hue" } }, this.#hueThumb);
    this.#chip = h("span", { class: "kvfx-cpick__chip" });
    this.#hex = h("input", {
      class: "kvfx-input kvfx-cpick__hex",
      type: "text",
      attrs: { "aria-label": "Hex colour", maxlength: "7", spellcheck: "false", autocomplete: "off" },
    });
    this.#swatches = h("div", { class: "kvfx-cpick__swatches" });
    const done = h("button", { class: "kvfx-pill kvfx-cpick__done", type: "button", text: "Done", on: { click: () => this.close() } });
    this.root = h(
      "div",
      { class: "kvfx-cpick", attrs: { role: "dialog", "aria-label": "Colour" } },
      this.#sv,
      this.#hue,
      h("div", { class: "kvfx-cpick__row" }, this.#chip, this.#hex, done),
      this.#swatches,
    );
    this.root.hidden = true;

    this.#drag(this.#sv, (x, y) => {
      this.#hsv = [this.#hsv[0], x, 1 - y];
      this.#apply(true);
    });
    this.#drag(this.#hue, (x) => {
      this.#hsv = [Math.min(359.9, x * 360), this.#hsv[1], this.#hsv[2]];
      this.#apply(true);
    });
    this.#hex.addEventListener("input", () => {
      const hex = normalizeHex(this.#hex.value);
      if (hex === undefined) return;
      this.#hsv = hsvOf(hex);
      this.#apply(false);
    });
    this.#hex.addEventListener("keydown", (event) => {
      // Typing stays in the field: nothing else in the panel acts on these keys.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        this.close();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#hsv = hsvOf(this.#original);
        this.#apply(true);
        this.close();
      }
    });
    this.#hex.addEventListener("blur", () => {
      this.#hex.value = this.value;
    });
    this.root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (this.root.hidden) return;
        const target = event.target as Node;
        if (this.root.contains(target) || this.#anchor?.contains(target)) return;
        this.close();
      },
      true,
    );
    window.addEventListener("resize", () => this.close());
  }

  get value(): string {
    return rgbToHex(hsvToRgb(this.#hsv));
  }

  get openFor(): HTMLElement | undefined {
    return this.root.hidden ? undefined : this.#anchor;
  }

  open(anchor: HTMLElement, hex: string, onPick: (hex: string) => void, onClose: () => void): void {
    if (this.#anchor !== undefined && this.#anchor !== anchor) this.close();
    if (!this.root.isConnected) document.body.append(this.root);
    this.#anchor = anchor;
    this.#onPick = onPick;
    this.#onClose = onClose;
    this.#original = hex;
    this.#hsv = hsvOf(hex);
    this.#paintSwatches();
    this.#apply(true, false);
    this.root.hidden = false;
    this.#place(anchor);
    // Ready to type a hex code straight away.
    this.#hex.focus();
    this.#hex.select();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    const hex = this.value;
    const at = recent.indexOf(hex);
    if (at !== -1) recent.splice(at, 1);
    if (hex !== this.#original) recent.unshift(hex);
    recent.length = Math.min(recent.length, RECENT_MAX);
    const done = this.#onClose;
    this.#anchor = undefined;
    this.#onPick = undefined;
    this.#onClose = undefined;
    done?.();
  }

  #place(anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    const top = below >= POPOVER_H + EDGE || box.top < POPOVER_H ? box.bottom + 4 : box.top - POPOVER_H - 4;
    const left = Math.max(EDGE, Math.min(window.innerWidth - POPOVER_W - EDGE, box.left));
    this.root.style.left = `${String(Math.round(left))}px`;
    this.root.style.top = `${String(Math.round(Math.max(EDGE, top)))}px`;
  }

  /** Paints the controls from the current colour; `emit` tells the field. */
  #apply(writeHex: boolean, emit = true): void {
    const [hue, s, v] = this.#hsv;
    const hex = this.value;
    this.#sv.style.backgroundColor = `hsl(${hue.toFixed(1)}, 100%, 50%)`;
    this.#svThumb.style.left = `${(s * 100).toFixed(2)}%`;
    this.#svThumb.style.top = `${((1 - v) * 100).toFixed(2)}%`;
    this.#hueThumb.style.left = `${((hue / 360) * 100).toFixed(2)}%`;
    this.#chip.style.backgroundColor = hex;
    if (writeHex) this.#hex.value = hex;
    for (const swatch of Array.from(this.#swatches.children)) toggleClass(swatch, "kvfx-cpick__swatch--on", (swatch as HTMLElement).dataset["hex"] === hex);
    if (emit) this.#onPick?.(hex);
  }

  #paintSwatches(): void {
    this.#swatches.textContent = "";
    const colours = [...recent, ...PALETTE.filter((p) => !recent.includes(p))].slice(0, 18);
    for (const hex of colours) {
      this.#swatches.append(
        h("button", {
          class: "kvfx-cpick__swatch",
          type: "button",
          title: hex,
          attrs: { "aria-label": hex, "data-hex": hex },
          style: { "background-color": hex },
          on: {
            click: () => {
              this.#hsv = hsvOf(hex);
              this.#apply(true);
            },
          },
        }),
      );
    }
  }

  /** Pointer dragging across `area`, reported as 0–1 fractions of its width and height. */
  #drag(area: HTMLElement, onMove: (x: number, y: number) => void): void {
    const at = (event: PointerEvent): void => {
      const box = area.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
      const y = Math.min(1, Math.max(0, (event.clientY - box.top) / Math.max(1, box.height)));
      onMove(x, y);
    };
    area.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      area.setPointerCapture(event.pointerId);
      at(event);
    });
    area.addEventListener("pointermove", (event) => {
      if (area.hasPointerCapture(event.pointerId)) at(event);
    });
  }
}

let shared: ColorPopover | undefined;
const popover = (): ColorPopover => (shared ??= new ColorPopover());

export interface ColorInput {
  /** The swatch button that opens the picker. */
  readonly swatch: HTMLButtonElement;
  /** Holds the current colour as "#rrggbb", for code that reads `.value`. */
  readonly input: HTMLInputElement;
  /** Shows a colour without telling the listener, e.g. after settings change. */
  set(hex: string): void;
  readonly isOpen: () => boolean;
}

export interface ColorInputOptions {
  /** An icon before the colour, so the control reads as a picker. */
  readonly icon?: string;
  /** Shows the hex code beside the colour. */
  readonly showHex?: boolean;
}

/** A swatch that opens the in-panel picker. `onChange` fires as the colour changes. */
export function colorInput(
  label: string,
  value: string,
  onChange?: (hex: string) => void,
  className = "kvfx-swatch",
  options: ColorInputOptions = {},
): ColorInput {
  const input = h("input", { type: "hidden", attrs: { value: normalizeHex(value) ?? "#ffffff" } });
  const chip = h("span", { class: "kvfx-swatch__chip" });
  const hexText = options.showHex === true ? h("span", { class: "kvfx-swatch__hex" }) : null;
  const swatch = h(
    "button",
    {
      class: className,
      type: "button",
      title: label,
      attrs: { "aria-label": label, "aria-haspopup": "dialog", "aria-expanded": "false" },
    },
    options.icon === undefined ? null : createIcon(options.icon, IconSize.medium),
    chip,
    hexText,
  );
  const paint = (hex: string): void => {
    input.value = hex;
    chip.style.backgroundColor = hex;
    swatch.title = `${label}: ${hex}`;
    if (hexText !== null) setText(hexText, hex.toUpperCase());
  };
  paint(input.value);
  swatch.addEventListener("click", () => {
    const picker = popover();
    if (picker.openFor === swatch) {
      picker.close();
      return;
    }
    swatch.setAttribute("aria-expanded", "true");
    picker.open(
      swatch,
      input.value,
      (hex) => {
        paint(hex);
        input.dispatchEvent(new Event("input"));
        onChange?.(hex);
      },
      () => swatch.setAttribute("aria-expanded", "false"),
    );
  });
  return {
    swatch,
    input,
    set: (hex: string): void => {
      const normal = normalizeHex(hex);
      if (normal !== undefined) paint(normal);
    },
    isOpen: () => popover().openFor === swatch,
  };
}
