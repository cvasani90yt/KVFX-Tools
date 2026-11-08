import { type JsonObject, SPEED_GROUPS, SPEED_RAMPS, type SpeedPreset, speedRampById } from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import { type CommandButtons, type Section, hint, numberField, row, toggles } from "../ui/controls.js";
import { h, setText, toggleClass } from "../ui/dom.js";
import { SpeedPreview } from "./speed-preview.js";

/**
 * Generate tab: Speed Ramp.
 *
 * A grid of speed curves with a live preview — hover one to see it, click to
 * pick it — then Add Speed Ramp puts it on the selected clips with its key
 * moment on the playhead.
 */

/* eslint-disable no-magic-numbers -- the section's opening values, mirrored from the command's defaults */

type MakeSection = (id: string, title: string, hintText?: string) => Section;

function num(params: JsonObject, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function value(input: HTMLInputElement, fallback: number): number {
  const n = Number.parseFloat(input.value);
  return Number.isFinite(n) ? n : fallback;
}

/** Builds the section and returns a hook to restart the preview when the tab is shown. */
export function buildSpeedRampSection(panel: Panel, buttons: CommandButtons, section: MakeSection): { shown: () => void } {
  const session = panel.session;
  const p = session.toolParams("speedRamp");
  let current: SpeedPreset = speedRampById(p["preset"]) ?? (SPEED_RAMPS[0] as SpeedPreset);

  const frames = numberField("Length", num(p, "frames", current.frames), { min: 2, max: 600, step: 1, unit: "fr" });
  const strength = numberField("Strength", num(p, "strength", 100), { min: 10, max: 200, step: 10, unit: "%" });
  const options = toggles(
    [
      { key: "fit", label: "Keep the ending", title: "Move the out point so the clip still ends on its last frame: slow motion makes it longer, speed shorter" },
      { key: "blend", label: "Frame blending", title: "Blend frames on the clip, so slow motion stays smooth" },
    ],
    { fit: p["fit"] !== false, blend: p["blend"] !== false },
    () => undefined,
  );

  const stage = h("canvas", { class: "kvfx-trans-stage kvfx-ramp-stage", attrs: { "aria-hidden": "true" } });
  const preview = new SpeedPreview(stage, () => ({ strength: value(strength.input, 100), frames: value(frames.input, current.frames) }));
  const about = h("p", { class: "kvfx-hint kvfx-trans-about", attrs: { "aria-live": "polite" } });

  const tiles = new Map<string, HTMLButtonElement>();
  // Twelve presets fit without scrolling, so every group stays in view.
  const grid = h("div", { class: "kvfx-tiles kvfx-ramp-tiles", attrs: { role: "listbox", "aria-label": "Speed ramp presets" } });
  const paint = (): void => {
    for (const [id, tile] of tiles) {
      toggleClass(tile, "kvfx-tile--on", id === current.id);
      tile.setAttribute("aria-selected", id === current.id ? "true" : "false");
    }
    setText(about, `${current.name}: ${current.about}`);
  };
  for (const group of SPEED_GROUPS) {
    grid.append(h("div", { class: "kvfx-presets__group", text: group.label }));
    for (const preset of SPEED_RAMPS.filter((x) => x.group === group.id)) {
      const tile = h("button", {
        class: "kvfx-tile",
        type: "button",
        text: preset.name,
        title: preset.about,
        attrs: { role: "option", "data-ramp": preset.id },
        on: {
          click: () => {
            current = preset;
            frames.input.value = String(preset.frames);
            session.setToolParams("speedRamp", { ...session.toolParams("speedRamp"), preset: preset.id, frames: preset.frames });
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

  section("gen.speedramp", "Speed Ramp", `${String(SPEED_RAMPS.length)} presets`).body.append(
    stage,
    about,
    grid,
    row(frames.root, strength.root),
    options.root,
    buttons.button("kvfx.rig.speedRamp", {
      label: "Add Speed Ramp",
      icon: "speed",
      variant: "wide",
      className: "kvfx-primary",
      params: () => {
        const params = {
          preset: current.id,
          frames: Math.round(value(frames.input, current.frames)),
          strength: value(strength.input, 100),
          fit: options.get("fit"),
          blend: options.get("blend"),
        };
        session.setToolParams("speedRamp", params);
        return params;
      },
    }),
    hint(
      "Select video or precomp clips and put the playhead on the moment to hit. Each ramp is a layer marker: drag it to move the ramp, stretch it to retime it, or edit the percentage in its comment. Turn on the comp's Frame Blending switch to see blended frames in the preview.",
    ),
  );
  paint();
  return { shown: () => preview.play(current) };
}
