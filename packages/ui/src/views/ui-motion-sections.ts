import {
  BACKDROP_PALETTES,
  type JsonObject,
  type JsonValue,
  REVEAL_STYLES,
  TEXT_EASES,
  UI_ORDERS,
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
  textField,
  toggles,
} from "../ui/controls.js";
import { h } from "../ui/dom.js";

/**
 * The Generate tab's UI Motion sections: UI Stagger, Cursor, Card Carousel
 * and Backdrop. Built from the same fields, segments and toggles as the rest
 * of the panel, each remembering its last values.
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

export function buildUiMotionSections(panel: Panel, buttons: CommandButtons, section: MakeSection): void {
  const session = panel.session;
  const remember = (tool: string, params: Record<string, JsonValue>): Record<string, JsonValue> => {
    session.setToolParams(tool, params);
    return params;
  };

  // --- UI Stagger -----------------------------------------------------------
  {
    const p = session.toolParams("uiStagger");
    const style = selectField("Style", REVEAL_STYLES.map((s) => ({ value: s.id, label: s.label })), str(p, "style", "rise"));
    const order = selectField("Order", UI_ORDERS.map((o) => ({ value: o.id, label: o.label })), str(p, "order", "topDown"));
    let mode = str(p, "mode", "in");
    const modeSeg = segmented(
      [
        { value: "in", label: "In" },
        { value: "out", label: "Out" },
        { value: "inOut", label: "In+Out", title: "In from the playhead, out at each layer's end" },
      ],
      mode,
      (next) => {
        mode = next;
        modeSeg.set(next);
      },
    );
    const stagger = numberField("Stagger", num(p, "stagger", 3), { min: 0, step: 1, unit: "fr" });
    const duration = numberField("Each", num(p, "duration", 18), { min: 1, step: 1, unit: "fr" });
    const distance = numberField("Distance", num(p, "distance", 80), { min: 0, step: 10, unit: "px" });
    const ease = selectField("Ease", TEXT_EASES.map((e) => ({ value: e.id, label: e.id === "preset" ? "Style default" : e.label })), str(p, "ease", "preset"));
    const overshoot = numberField("Overshoot", num(p, "overshoot", 30), { min: 0, max: 100, step: 5, unit: "%" });
    section("gen.uistagger", "UI Stagger", "interface reveal").body.append(
      row(style.root, order.root),
      modeSeg.root,
      row(stagger.root, duration.root, distance.root),
      row(ease.root, overshoot.root),
      buttons.button("kvfx.rig.uistagger", {
        label: "Stagger In",
        icon: "ui-stagger",
        variant: "wide",
        className: "kvfx-primary",
        params: () =>
          ({
            ...remember("uiStagger", {
              style: style.select.value,
              order: order.select.value,
              mode,
              stagger: value(stagger.input, 3),
              duration: value(duration.input, 18),
              distance: value(distance.input, 80),
              ease: ease.select.value,
              overshoot: value(overshoot.input, 30),
            }),
            bezier: [...session.state.settings.ui.ease],
            seed: 1 + Math.floor(Math.random() * 99_999),
          }),
      }),
      hint("Each layer keeps its own position and animation. Retime one by moving the two keys on its KVFX Reveal slider."),
    );
  }

  // --- Cursor -----------------------------------------------------------------
  {
    const p = session.toolParams("cursor");
    let style = str(p, "style", "arrow");
    const styleSeg = segmented(
      [
        { value: "arrow", label: "Arrow" },
        { value: "pointer", label: "Hand" },
        { value: "touch", label: "Touch" },
      ],
      style,
      (next) => {
        style = next;
        styleSeg.set(next);
      },
    );
    const order = selectField("Click order", UI_ORDERS.map((o) => ({ value: o.id, label: o.label })), str(p, "order", "topDown"));
    const travel = numberField("Travel", num(p, "travel", 0.8), { min: 0.05, step: 0.1, unit: "s" });
    const hold = numberField("Hold", num(p, "hold", 0.6), { min: 0, step: 0.1, unit: "s" });
    const size = numberField("Size", num(p, "size", 36), { min: 6, step: 2, unit: "px" });
    const arc = numberField("Arc", num(p, "arc", 18), { min: -100, max: 100, step: 2, unit: "%" });
    const tilt = numberField("Tilt", num(p, "tilt", 12), { min: 0, max: 60, step: 1, unit: "°" });
    const lift = numberField("Lift", num(p, "lift", 8), { min: 0, max: 100, step: 1, unit: "%" });
    const extras = toggles(
      [
        { key: "shadow", label: "Shadow" },
        { key: "ripple", label: "Ripple" },
        { key: "press", label: "Press", title: "The clicked layer dips as it is pressed" },
      ],
      { shadow: bool(p, "shadow", true), ripple: bool(p, "ripple", true), press: bool(p, "press", true) },
      () => undefined,
    );
    const tag = textField("Name tag", str(p, "tag", ""), undefined, "Optional, e.g. Alex");
    const color = colorField("Accent", str(p, "color", "#ff8f3f"));
    section("gen.cursor", "Cursor", "clicks through the selection").body.append(
      row(styleSeg.root, order.root),
      row(travel.root, hold.root, size.root),
      row(arc.root, tilt.root, lift.root),
      extras.root,
      row(tag.root, color.root),
      buttons.button("kvfx.rig.cursor", {
        label: "Add Cursor",
        icon: "cursor",
        variant: "wide",
        params: () => {
          const saved = remember("cursor", {
            style,
            order: order.select.value,
            travel: value(travel.input, 0.8),
            hold: value(hold.input, 0.6),
            size: value(size.input, 36),
            arc: value(arc.input, 18),
            tilt: value(tilt.input, 12),
            lift: value(lift.input, 8),
            shadow: extras.get("shadow"),
            ripple: extras.get("ripple"),
            press: extras.get("press"),
            tag: tag.input.value,
            color: color.input.value,
          });
          return { ...saved, buttonPress: extras.get("press") ? 6 : 0, bezier: [...session.state.settings.ui.ease] };
        },
      }),
      hint("Select the buttons and cards to click, in any order — the cursor visits them in Click order, starting at the playhead."),
    );
  }

  // --- Card Carousel ------------------------------------------------------------
  {
    const p = session.toolParams("cardCarousel");
    const gap = numberField("Gap", num(p, "gap", 60), { step: 10, unit: "px" });
    const side = numberField("Side size", num(p, "side", 80), { min: 1, max: 400, step: 5, unit: "%" });
    const sideOpacity = numberField("Side fade", num(p, "sideOpacity", 45), { min: 0, max: 100, step: 5, unit: "%" });
    const hold = numberField("Hold", num(p, "hold", 1.4), { min: 0, step: 0.1, unit: "s" });
    const move = numberField("Move", num(p, "move", 0.6), { min: 0.05, step: 0.1, unit: "s" });
    const loop = toggles([{ key: "loop", label: "Loop" }], { loop: bool(p, "loop", true) }, () => undefined);
    section("gen.cardcarousel", "Card Carousel", "focus card").body.append(
      row(gap.root, side.root, sideOpacity.root),
      row(hold.root, move.root, loop.root),
      buttons.button("kvfx.rig.cardcarousel", {
        label: "Build Card Carousel",
        icon: "card-carousel",
        variant: "wide",
        params: () =>
          remember("cardCarousel", {
            gap: value(gap.input, 60),
            side: value(side.input, 80),
            sideOpacity: value(sideOpacity.input, 45),
            hold: value(hold.input, 1.4),
            move: value(move.input, 0.6),
            loop: loop.get("loop"),
          }),
      }),
      hint("Select two or more cards. Every setting lives on the KVFX Card Carousel null — key its Index to drive it by hand."),
    );
  }

  // --- Backdrop -----------------------------------------------------------------
  {
    const p = session.toolParams("backdrop");
    let style = str(p, "style", "drift");
    const styleSeg = segmented(
      [
        { value: "drift", label: "Drift" },
        { value: "horizon", label: "Horizon" },
        { value: "stars", label: "Stars" },
      ],
      style,
      (next) => {
        style = next;
        styleSeg.set(next);
      },
    );
    const palette = selectField("Palette", BACKDROP_PALETTES.map((x) => ({ value: x.id, label: x.name })), str(p, "palette", "ember"));
    const strip = h("div", { class: "kvfx-palette-strip", attrs: { "aria-hidden": "true" } });
    const paint = (): void => {
      const chosen = BACKDROP_PALETTES.find((x) => x.id === palette.select.value) ?? BACKDROP_PALETTES[0];
      strip.style.background = chosen === undefined ? "" : `linear-gradient(90deg, ${chosen.colors.join(", ")})`;
    };
    palette.select.addEventListener("change", paint);
    paint();
    const speed = numberField("Speed", num(p, "speed", 1), { min: 0, max: 20, step: 0.25, unit: "×" });
    const options = toggles(
      [
        { key: "grain", label: "Grain" },
        { key: "clip", label: "Clip to layer", title: "Fill only the selected layer's shape, above it" },
      ],
      { grain: bool(p, "grain", true), clip: bool(p, "clip", false) },
      () => undefined,
    );
    section("gen.backdrop", "Backdrop", "animated background").body.append(
      styleSeg.root,
      row(palette.root, speed.root),
      strip,
      options.root,
      buttons.button("kvfx.rig.backdrop", {
        label: "Add Backdrop",
        icon: "backdrop",
        variant: "wide",
        params: () =>
          remember("backdrop", {
            style,
            palette: palette.select.value,
            speed: value(speed.input, 1),
            grain: options.get("grain"),
            clip: options.get("clip"),
          }),
      }),
      hint("Goes to the bottom of the stack, or with Clip to layer fills the selected layer's shape. Speed lives on the layer."),
    );
  }
}
