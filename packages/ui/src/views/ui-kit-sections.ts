import type { JsonObject, JsonValue } from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import {
  type CommandButtons,
  type Section,
  colorField,
  hint,
  numberField,
  optionalNumber,
  row,
  segmented,
  textField,
  toggles,
} from "../ui/controls.js";

/**
 * Generate tab: Hover Lift, Dot Pulse, Frosted Glass, Wipe Reveal, Code
 * Glyphs and Input Bar.
 */

/* eslint-disable no-magic-numbers -- each tool's opening values, mirrored from its command's defaults */

type MakeSection = (id: string, title: string, hintText?: string) => Section;

function num(params: JsonObject, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(params: JsonObject, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

function bool(params: JsonObject, key: string, fallback: boolean): boolean {
  const value = params[key];
  return typeof value === "boolean" ? value : fallback;
}

function value(input: HTMLInputElement, fallback: number): number {
  const n = Number.parseFloat(input.value);
  return Number.isFinite(n) ? n : fallback;
}

/** A segmented control that remembers its choice in a variable it hands back. */
function choice<T extends string>(options: readonly { value: T; label: string; title?: string }[], initial: T): { root: HTMLElement; get: () => T } {
  let current = initial;
  const seg = segmented(options, initial, (next) => {
    current = next;
    seg.set(next);
  });
  return { root: seg.root, get: () => current };
}

export function buildUiKitSections(panel: Panel, buttons: CommandButtons, section: MakeSection): void {
  const session = panel.session;
  const remember = (tool: string, params: Record<string, JsonValue>): Record<string, JsonValue> => {
    session.setToolParams(tool, params);
    return params;
  };

  // --- Hover Lift -------------------------------------------------------------
  {
    const p = session.toolParams("hover");
    const radius = numberField("Radius", num(p, "radius", 160), { min: 1, step: 10, unit: "px" });
    const scale = numberField("Grow", num(p, "scale", 6), { step: 1, unit: "%" });
    const lift = numberField("Lift", num(p, "lift", 10), { step: 1, unit: "px" });
    section("gen.hover", "Hover Lift", "react to a cursor").body.append(
      row(radius.root, scale.root, lift.root),
      buttons.button("kvfx.rig.hover", {
        label: "Add Hover",
        icon: "hover",
        variant: "wide",
        params: () => remember("hover", { radius: value(radius.input, 160), scale: value(scale.input, 6), lift: value(lift.input, 10) }),
      }),
      hint("Select a KVFX Cursor (or any layer, on top) and the layers that should react. Retune with the Hover sliders on each layer."),
    );
  }

  // --- Input Bar --------------------------------------------------------------
  {
    const p = session.toolParams("inputBar");
    const text = textField("Typed text", str(p, "text", "Make a launch video for my app"));
    const placeholder = textField("Placeholder", str(p, "placeholder", "Search or type a message…"));
    const theme = choice(
      [
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ],
      str(p, "theme", "dark") === "light" ? "light" : "dark",
    );
    const color = colorField("Accent", str(p, "color", "#ff8f3f"));
    const width = numberField("Width", 0, { min: 120, step: 20, unit: "px" });
    width.input.value = typeof p["width"] === "number" ? String(p["width"]) : "";
    width.input.placeholder = "half";
    const speed = numberField("Speed", num(p, "speed", 18), { min: 1, step: 1, unit: "ch/s" });
    section("gen.inputbar", "Input Bar", "types, then sends").body.append(
      text.root,
      placeholder.root,
      row(theme.root, color.root),
      row(width.root, speed.root),
      buttons.button("kvfx.rig.inputbar", {
        label: "Add Input Bar",
        icon: "input-bar",
        variant: "wide",
        params: () => {
          const w = optionalNumber(width.input);
          return remember("inputBar", {
            text: text.input.value,
            placeholder: placeholder.input.value,
            theme: theme.get(),
            color: color.input.value,
            speed: value(speed.input, 18),
            ...(w === undefined ? {} : { width: w }),
          });
        },
      }),
      hint("Typing starts at the playhead. Move the whole bar with its KVFX Input Bar null."),
    );
  }

  // --- Dot Pulse ----------------------------------------------------------------
  {
    const p = session.toolParams("dotPulse");
    const placement = choice(
      [
        { value: "behind", label: "Behind", title: "Around and behind the selected layer" },
        { value: "inside", label: "Inside", title: "Within the selected layer's shape" },
        { value: "comp", label: "Whole comp" },
      ],
      ((): "behind" | "inside" | "comp" => {
        const v = str(p, "placement", "behind");
        return v === "inside" || v === "comp" ? v : "behind";
      })(),
    );
    const spacing = numberField("Spacing", num(p, "spacing", 28), { min: 4, step: 2, unit: "px" });
    const size = numberField("Dot", num(p, "size", 9), { min: 1, step: 1, unit: "px" });
    const color = colorField("Colour", str(p, "color", "#ff8f3f"));
    const speed = numberField("Speed", num(p, "speed", 0.9), { min: 0.01, step: 0.1 });
    const width = numberField("Band", num(p, "width", 18), { min: 1, max: 100, step: 1, unit: "%" });
    const every = numberField("Every", num(p, "every", 2.2), { min: 0.1, step: 0.1, unit: "s" });
    section("gen.dotpulse", "Dot Pulse", "halftone wave").body.append(
      placement.root,
      row(spacing.root, size.root, color.root),
      row(speed.root, width.root, every.root),
      buttons.button("kvfx.rig.dotpulse", {
        label: "Add Dot Pulse",
        icon: "dot-pulse",
        variant: "wide",
        params: () =>
          remember("dotPulse", {
            placement: placement.get(),
            spacing: value(spacing.input, 28),
            size: value(size.input, 9),
            color: color.input.value,
            speed: value(speed.input, 0.9),
            width: value(width.input, 18),
            every: value(every.input, 2.2),
          }),
      }),
      hint("Without a selection it covers the comp. Speed, band and interval stay live on the layer."),
    );
  }

  // --- Frosted Glass --------------------------------------------------------------
  {
    const p = session.toolParams("glass");
    const blur = numberField("Blur", num(p, "blur", 28), { min: 0, step: 2, unit: "px" });
    const frost = numberField("Frost", num(p, "frost", 12), { min: 0, max: 100, step: 2, unit: "%" });
    const tint = colorField("Tint", str(p, "tint", "#ffffff"));
    const opacity = numberField("Card", 0, { min: 0, max: 100, step: 5, unit: "%" });
    opacity.input.value = typeof p["cardOpacity"] === "number" ? String(p["cardOpacity"]) : "";
    opacity.input.placeholder = "keep";
    section("gen.glass", "Frosted Glass", "blur behind a card").body.append(
      row(blur.root, frost.root, tint.root),
      opacity.root,
      buttons.button("kvfx.rig.glass", {
        label: "Make Glass",
        icon: "glass",
        variant: "wide",
        params: () => {
          const card = optionalNumber(opacity.input);
          return remember("glass", {
            blur: value(blur.input, 28),
            frost: value(frost.input, 12),
            tint: tint.input.value,
            ...(card === undefined ? {} : { cardOpacity: card }),
          });
        },
      }),
      hint("Select the card. Everything behind it is blurred within its shape. Leave Card empty to keep the card's own opacity."),
    );
  }

  // --- Wipe Reveal ------------------------------------------------------------------
  {
    const p = session.toolParams("wipe");
    const direction = choice(
      [
        { value: "right", label: "→", title: "Left to right" },
        { value: "left", label: "←", title: "Right to left" },
        { value: "down", label: "↓", title: "Top to bottom" },
        { value: "up", label: "↑", title: "Bottom to top" },
      ],
      ((): "right" | "left" | "down" | "up" => {
        const v = str(p, "direction", "right");
        return v === "left" || v === "down" || v === "up" ? v : "right";
      })(),
    );
    const mode = choice(
      [
        { value: "in", label: "In" },
        { value: "out", label: "Out" },
      ],
      str(p, "mode", "in") === "out" ? "out" : "in",
    );
    const duration = numberField("Each", num(p, "duration", 20), { min: 1, step: 1, unit: "fr" });
    const stagger = numberField("Stagger", num(p, "stagger", 4), { min: 0, step: 1, unit: "fr" });
    const feather = numberField("Edge", num(p, "feather", 60), { min: 0, step: 10, unit: "px" });
    section("gen.wipe", "Wipe Reveal", "soft-edged").body.append(
      row(direction.root, mode.root),
      row(duration.root, stagger.root, feather.root),
      buttons.button("kvfx.rig.wipe", {
        label: "Wipe",
        icon: "wipe",
        variant: "wide",
        params: () => ({
          ...remember("wipe", {
            direction: direction.get(),
            mode: mode.get(),
            duration: value(duration.input, 20),
            stagger: value(stagger.input, 4),
            feather: value(feather.input, 60),
          }),
          bezier: [...session.state.settings.ui.ease],
        }),
      }),
      hint("Uses the Ease tab's curve, from the playhead, top layer first."),
    );
  }

  // --- Code Glyphs ------------------------------------------------------------------
  {
    const p = session.toolParams("codeGlyphs");
    const text = textField("Headline", str(p, "text", "Ship faster"));
    const color = colorField("Colour", str(p, "color", "#ff8f3f"));
    const parts = toggles(
      [
        { key: "lines", label: "Code" },
        { key: "glyphs", label: "Glyphs" },
        { key: "flicker", label: "Flicker" },
      ],
      { lines: bool(p, "lines", true), glyphs: bool(p, "glyphs", true), flicker: bool(p, "flicker", true) },
      () => undefined,
    );
    const rows = numberField("Rows", num(p, "rows", 6), { min: 1, max: 30, step: 1 });
    const speed = numberField("Lines/s", num(p, "speed", 1.6), { min: 0.05, step: 0.1 });
    section("gen.codeglyphs", "Code Glyphs", "tech title").body.append(
      row(text.root, color.root),
      parts.root,
      row(rows.root, speed.root),
      buttons.button("kvfx.rig.codeglyphs", {
        label: "Build Title",
        icon: "code",
        variant: "wide",
        params: () =>
          remember("codeGlyphs", {
            text: text.input.value,
            color: color.input.value,
            lines: parts.get("lines"),
            glyphs: parts.get("glyphs"),
            flicker: parts.get("flicker"),
            rows: value(rows.input, 6),
            speed: value(speed.input, 1.6),
          }),
      }),
    );
  }
}
