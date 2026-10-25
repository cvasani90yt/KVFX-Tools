import { DEFAULT_TRANSITION_COLOR, type JsonObject, TRANSITIONS, TRANSITION_GROUPS, type TransitionPreset, hexToRgb, rgbToHex, transitionById } from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import { type CommandButtons, type Section, colorField, hint, numberField, row, toggles } from "../ui/controls.js";
import { h, setText, toggleClass } from "../ui/dom.js";
import { TransitionPreview } from "./transition-preview.js";

/**
 * Generate tab: Transitions.
 *
 * A grid of presets with a live preview — hover one to see it, click to pick
 * it — then Add Transition puts it across the cut at the playhead.
 */

/* eslint-disable no-magic-numbers -- the section's opening values, mirrored from the command's defaults */

type MakeSection = (id: string, title: string, hintText?: string) => Section;

const MAX_SEED = 100_000;

function num(params: JsonObject, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function value(input: HTMLInputElement, fallback: number): number {
  const n = Number.parseFloat(input.value);
  return Number.isFinite(n) ? n : fallback;
}

/** Builds the section and returns a hook to restart the preview when the tab is shown. */
export function buildTransitionsSection(panel: Panel, buttons: CommandButtons, section: MakeSection): { shown: () => void } {
  const session = panel.session;
  const p = session.toolParams("transition");
  let current: TransitionPreset = transitionById(p["preset"]) ?? (TRANSITIONS[0] as TransitionPreset);

  const frames = numberField("Length", num(p, "frames", current.frames), { min: 2, max: 600, step: 1, unit: "fr" });
  const strength = numberField("Strength", num(p, "strength", 100), { min: 0, max: 400, step: 10, unit: "%" });
  const color = colorField("Colour", typeof p["color"] === "string" ? p["color"] : rgbToHex(DEFAULT_TRANSITION_COLOR));
  const options = toggles([{ key: "snap", label: "Snap to cut", title: "Centre on a selected clip's in or out point near the playhead" }], { snap: p["snap"] !== false }, () => undefined);

  const stage = h("canvas", { class: "kvfx-trans-stage", attrs: { "aria-hidden": "true" } });
  const preview = new TransitionPreview(stage, () => ({
    strength: value(strength.input, 100),
    frames: value(frames.input, current.frames),
    color: hexToRgb(color.input.value) ?? DEFAULT_TRANSITION_COLOR,
  }));
  const about = h("p", { class: "kvfx-hint kvfx-trans-about", attrs: { "aria-live": "polite" } });

  const tiles = new Map<string, HTMLButtonElement>();
  const grid = h("div", { class: "kvfx-tiles kvfx-tiles--scroll kvfx-trans-tiles", attrs: { role: "listbox", "aria-label": "Transition presets" } });
  const paint = (): void => {
    for (const [id, tile] of tiles) {
      toggleClass(tile, "kvfx-tile--on", id === current.id);
      tile.setAttribute("aria-selected", id === current.id ? "true" : "false");
    }
    setText(about, `${current.name}: ${current.about}`);
    // Only the graphic wipes are drawn in a colour.
    color.root.hidden = current.group !== "graphic";
  };
  for (const group of TRANSITION_GROUPS) {
    grid.append(h("div", { class: "kvfx-presets__group", text: group.label }));
    for (const preset of TRANSITIONS.filter((x) => x.group === group.id)) {
      const tile = h("button", {
        class: "kvfx-tile",
        type: "button",
        text: preset.name,
        title: preset.about,
        attrs: { role: "option" },
        on: {
          click: () => {
            current = preset;
            frames.input.value = String(preset.frames);
            session.setToolParams("transition", { ...session.toolParams("transition"), preset: preset.id, frames: preset.frames });
            paint();
            preview.play(preset);
          },
          mouseenter: () => preview.play(preset),
          mouseleave: () => preview.play(current),
          focus: () => preview.play(preset),
        },
      });
      tiles.set(preset.id, tile);
      grid.append(tile);
    }
  }

  section("gen.transitions", "Transitions", `${String(TRANSITIONS.length)} presets`).body.append(
    stage,
    about,
    grid,
    row(frames.root, strength.root, color.root),
    options.root,
    buttons.button("kvfx.rig.transition", {
      label: "Add Transition",
      icon: "transition",
      variant: "wide",
      className: "kvfx-primary",
      params: () => {
        const params = {
          preset: current.id,
          frames: Math.round(value(frames.input, current.frames)),
          strength: value(strength.input, 100),
          color: color.input.value,
          snap: options.get("snap"),
        };
        session.setToolParams("transition", params);
        // A new seed each time, so glitches and shakes never repeat exactly.
        return { ...params, seed: Math.floor(Math.random() * MAX_SEED) };
      },
    }),
    hint("Put the playhead on a cut, or select the two clips and it snaps to the nearest one. Trim the layer to retime it; its KVFX Strength slider changes the amount afterwards."),
  );
  paint();
  return { shown: () => preview.play(current) };
}
