import {
  AnchorSpot,
  COMP_PRESETS,
  type JsonObject,
  type JsonValue,
  SILENCE_PRESETS,
  type SilenceOptions,
  type SilenceResult,
  findSilences,
} from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import {
  type CommandButtons,
  type Section,
  actionButton,
  hint,
  numberField,
  optionalNumber,
  row,
  segmented,
  selectField,
  toggles,
} from "../ui/controls.js";
import { h, setEnabled, setText, toggleClass } from "../ui/dom.js";

/**
 * The Tools tab's Comp Resizer and Silence Remover.
 */

/* eslint-disable no-magic-numbers -- each tool's opening values and drawing sizes */

type MakeSection = (id: string, title: string, hintText?: string) => Section;

const SPOTS: readonly AnchorSpot[] = [
  AnchorSpot.TopLeft,
  AnchorSpot.TopCentre,
  AnchorSpot.TopRight,
  AnchorSpot.MiddleLeft,
  AnchorSpot.Centre,
  AnchorSpot.MiddleRight,
  AnchorSpot.BottomLeft,
  AnchorSpot.BottomCentre,
  AnchorSpot.BottomRight,
];

function num(params: JsonObject, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export interface ToolsExtras {
  update(state: SessionState): void;
}

export function buildResizeAndSilence(panel: Panel, buttons: CommandButtons, section: MakeSection): ToolsExtras {
  const session = panel.session;

  // --- Comp Resizer ---------------------------------------------------------
  const r = session.toolParams("resize");
  const width = numberField("W", num(r, "width", 1080), { min: 4, step: 2, unit: "px" });
  const height = numberField("H", num(r, "height", 1920), { min: 4, step: 2, unit: "px" });
  const preset = selectField(
    "Format",
    [{ value: "", label: "Custom" }, ...COMP_PRESETS.map((p) => ({ value: p.id, label: p.label }))],
    typeof r["preset"] === "string" ? r["preset"] : "vertical",
    (id) => {
      const chosen = COMP_PRESETS.find((p) => p.id === id);
      if (chosen === undefined) return;
      width.input.value = String(chosen.width);
      height.input.value = String(chosen.height);
    },
  );
  const markCustom = (): void => {
    preset.select.value = "";
  };
  width.input.addEventListener("change", markCustom);
  height.input.addEventListener("change", markCustom);
  const swap = actionButton(
    "Swap width and height",
    () => {
      const w = width.input.value;
      width.input.value = height.input.value;
      height.input.value = w;
      markCustom();
    },
    { icon: "swap", variant: "tool" },
  );
  const percent = numberField("Scale", 0, { min: 1, step: 5, unit: "%" });
  percent.input.value = typeof r["percent"] === "number" ? String(r["percent"]) : "";
  percent.input.placeholder = "—";
  const duration = numberField("Length", 0, { min: 0.04, step: 1, unit: "s" });
  duration.input.value = typeof r["duration"] === "number" ? String(r["duration"]) : "";
  duration.input.placeholder = "same";
  const fps = numberField("FPS", 0, { min: 1, step: 1 });
  fps.input.value = typeof r["frameRate"] === "number" ? String(r["frameRate"]) : "";
  fps.input.placeholder = "same";
  let fit = r["fit"] === "fit" || r["fit"] === "fill" ? r["fit"] : "keep";
  const fitSeg = segmented(
    [
      { value: "keep", label: "Keep", title: "Content keeps its size, pinned to the anchor" },
      { value: "fit", label: "Fit", title: "Content scales to fit inside the new frame" },
      { value: "fill", label: "Fill", title: "Content scales to fill the new frame" },
    ],
    fit,
    (value) => {
      fit = value;
      fitSeg.set(value);
    },
  );
  let anchor = typeof r["anchor"] === "string" ? r["anchor"] : AnchorSpot.Centre;
  const anchorButtons = SPOTS.map((spot) =>
    h(
      "button",
      {
        class: "kvfx-tool kvfx-anchor",
        type: "button",
        title: `Pin content to the ${spot.replace(/([A-Z])/g, " $1").toLowerCase()}`,
        attrs: { "aria-label": spot },
        on: {
          click: () => {
            anchor = spot;
            paintAnchor();
          },
        },
      },
      createIcon(spot === AnchorSpot.Centre ? "arrow-c" : `arrow-${{ topLeft: "nw", topCentre: "n", topRight: "ne", middleLeft: "w", middleRight: "e", bottomLeft: "sw", bottomCentre: "s", bottomRight: "se", centre: "c" }[spot]}`, IconSize.small),
    ),
  );
  const paintAnchor = (): void => {
    SPOTS.forEach((spot, i) => {
      const button = anchorButtons[i];
      if (button !== undefined) toggleClass(button, "kvfx-tool--on", spot === anchor);
    });
  };
  paintAnchor();
  const anchorGrid = h("div", { class: "kvfx-anchors kvfx-anchors--pick", attrs: { "aria-label": "Pin content to" } }, ...anchorButtons);
  const resizeOptions = toggles(
    [
      { key: "extend", label: "Extend layers", title: "Layers that ran to the old end run to the new one" },
      { key: "fixParents", label: "Fix parents", title: "Comps that use these stay exactly as they look now" },
    ],
    { extend: r["extend"] !== false, fixParents: r["fixParents"] !== false },
    () => undefined,
  );
  const target = h("p", { class: "kvfx-hint kvfx-target" });

  section("tools.resize", "Comp Resizer", "batch").body.append(
    row(preset.root, swap),
    row(width.root, height.root, percent.root),
    h("div", { class: "kvfx-row kvfx-row--top" }, anchorGrid, h("div", { class: "kvfx-stack" }, fitSeg.root, row(duration.root, fps.root))),
    resizeOptions.root,
    buttons.button("kvfx.comp.resize", {
      label: "Resize Comps",
      icon: "resize",
      variant: "wide",
      params: () => {
        const scale = optionalNumber(percent.input);
        const params: Record<string, JsonValue> = {
          preset: preset.select.value,
          width: Number(width.input.value) || 1920,
          height: Number(height.input.value) || 1080,
          fit,
          anchor,
          extend: resizeOptions.get("extend"),
          fixParents: resizeOptions.get("fixParents"),
          percent: scale ?? null,
          duration: optionalNumber(duration.input) ?? null,
          frameRate: optionalNumber(fps.input) ?? null,
        };
        session.setToolParams("resize", params);
        return params;
      },
    }),
    target,
    hint("Scale overrides W and H. Content stays pinned to the highlighted spot; Fix parents keeps every comp that uses these looking the same."),
  );

  // --- Silence Remover --------------------------------------------------------
  const s = session.toolParams("silence");
  const balanced = SILENCE_PRESETS[1] ?? { threshold: 9, minSilence: 0.45, padding: 0.12 };
  const threshold = numberField("Threshold", num(s, "threshold", balanced.threshold), { min: 0, max: 100, step: 1, unit: "%" });
  const minimum = numberField("Min pause", num(s, "minSilence", balanced.minSilence), { min: 0.05, step: 0.05, unit: "s" });
  const padding = numberField("Padding", num(s, "padding", balanced.padding), { min: 0, step: 0.02, unit: "s" });
  const presetSeg = segmented(
    SILENCE_PRESETS.map((p) => ({ value: p.id, label: p.name, title: `${String(p.threshold)}% · ${String(p.minSilence)} s · pad ${String(p.padding)} s` })),
    typeof s["preset"] === "string" ? s["preset"] : "balanced",
    (id) => {
      const chosen = SILENCE_PRESETS.find((p) => p.id === id);
      if (chosen === undefined) return;
      presetSeg.set(id);
      threshold.input.value = String(chosen.threshold);
      minimum.input.value = String(chosen.minSilence);
      padding.input.value = String(chosen.padding);
      redraw();
    },
  );
  let action = s["action"] === "gaps" || s["action"] === "markers" ? s["action"] : "close";
  const actionSeg = segmented(
    [
      { value: "close", label: "Cut + close", title: "Remove the pauses and slide everything after them earlier" },
      { value: "gaps", label: "Keep gaps", title: "Remove the pauses but leave the time where they were" },
      { value: "markers", label: "Markers", title: "Only mark the pauses on the analysed layer" },
    ],
    action,
    (value) => {
      action = value;
      actionSeg.set(value);
    },
  );
  const canvas = h("canvas", { class: "kvfx-wave", attrs: { width: "560", height: "64", "aria-hidden": "true" } });
  const summary = h("p", { class: "kvfx-hint" }, "Select the voice layer (and any layers to cut with it), then Analyse.");
  let analysis: { id: number; name: string; start: number; frameDuration: number; samples: number[] } | undefined;
  let result: SilenceResult | undefined;

  const options = (): SilenceOptions => ({
    threshold: Math.max(0, Number(threshold.input.value) || 0),
    minSilence: Math.max(0.01, Number(minimum.input.value) || 0.3),
    padding: Math.max(0, Number(padding.input.value) || 0),
  });

  const redraw = (): void => {
    const context = canvas.getContext("2d");
    if (analysis === undefined) {
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    result = findSilences(analysis.samples, analysis.start, analysis.frameDuration, options());
    if (context !== null) drawWave(context, canvas, analysis, result);
    const pauses = result.silences.length;
    setText(
      summary,
      pauses === 0
        ? `${analysis.name}: no pauses at these settings.`
        : `${analysis.name}: ${String(pauses)} pause${pauses === 1 ? "" : "s"}, ${result.removed.toFixed(1)} s to remove.`,
    );
  };
  for (const field of [threshold, minimum, padding]) {
    field.input.addEventListener("input", () => {
      session.setToolParams("silence", options() as unknown as Record<string, JsonValue>);
      redraw();
    });
  }

  const analyse = actionButton("Analyse", () => void runAnalysis(), { icon: "silence", variant: "wide" });
  const apply = actionButton("Cut Pauses", () => void removeSilences(), { icon: "split", variant: "wide", title: "Remove the pauses found above" });
  apply.classList.add("kvfx-primary");

  const runAnalysis = async (): Promise<void> => {
    const first = session.state.snapshot.layers[0];
    if (first === undefined) {
      session.report("Silence Remover", false, "Select the voice layer first.");
      return;
    }
    const value = await session.runPlan("Analyse Audio", [{ op: "kvfx.op.audio.analyse", args: { id: first.id } }], 60_000);
    const step = (value as { steps?: { result?: unknown }[] } | null)?.steps?.[0]?.result as typeof analysis | undefined;
    if (step === undefined || !Array.isArray(step.samples)) return;
    analysis = step;
    redraw();
  };

  const removeSilences = async (): Promise<void> => {
    if (analysis === undefined || result === undefined) {
      session.report("Silence Remover", false, "Analyse a layer first.");
      return;
    }
    if (result.silences.length === 0) {
      session.report("Silence Remover", true, "No pauses to remove at these settings.");
      return;
    }
    session.setToolParams("silence", { action });
    if (action === "markers") {
      await session.runPlan("Mark Silences", [
        {
          op: "kvfx.op.layer.markers",
          args: { ids: [analysis.id], markers: result.silences.map((x) => ({ time: x.start, duration: x.end - x.start, comment: "Silence" })) },
        },
      ]);
      return;
    }
    const layers = session.state.snapshot.layers.length;
    const ok = await panel.confirm({
      title: "Remove silences?",
      body: `${String(result.silences.length)} pauses (${result.removed.toFixed(1)} s) are cut from ${String(layers)} selected layer${layers === 1 ? "" : "s"}${action === "close" ? " and the gaps closed" : ""}. Each layer is trimmed and split, never deleted; Edit ▸ Undo reverts it.`,
      confirmLabel: "Remove Silences",
    });
    if (!ok) return;
    await session.runPlan("Remove Silences", [
      { op: "kvfx.op.layer.cutRanges", args: { target: "selection", close: action === "close", keep: result.keep.map((k) => ({ start: k.start, end: k.end })) } },
    ]);
    analysis = undefined;
    result = undefined;
    redraw();
    setText(summary, "Done. Analyse again to look for more.");
  };

  section("tools.silence", "Silence Remover", "voice tracks").body.append(
    presetSeg.root,
    row(threshold.root, minimum.root, padding.root),
    canvas,
    summary,
    actionSeg.root,
    h("div", { class: "kvfx-actions" }, analyse, apply),
    hint("Analysis reads the first selected layer's audio; cuts apply to every selected layer, so picture and sound stay in sync."),
  );

  return {
    update(state: SessionState): void {
      const { projectComps, comp } = state.snapshot;
      const names = projectComps.length > 0 ? projectComps.map((c) => c.name) : comp === undefined ? [] : [comp.name];
      setText(
        target,
        names.length === 0
          ? "Select comps in the Project panel, or open one."
          : `Will resize: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${String(names.length - 3)} more` : ""}.`,
      );
      const busy = state.busy;
      setEnabled(analyse, !busy && state.snapshot.layers.length > 0, "Select the voice layer first.");
      setEnabled(apply, !busy && analysis !== undefined, "Analyse a layer first.");
    },
  };
}

function drawWave(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  analysis: { start: number; frameDuration: number; samples: number[] },
  result: SilenceResult,
): void {
  const styles = getComputedStyle(canvas);
  const accent = styles.getPropertyValue("--kvfx-accent").trim() || "#ff8f3f";
  const muted = styles.getPropertyValue("--kvfx-text-muted").trim() || "#6b6f78";
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const samples = analysis.samples;
  if (samples.length === 0) return;
  const total = samples.length * analysis.frameDuration;
  const x = (t: number): number => ((t - analysis.start) / total) * width;

  context.fillStyle = "rgba(255, 255, 255, 0.06)";
  for (const silence of result.silences) context.fillRect(x(silence.start), 0, Math.max(1, x(silence.end) - x(silence.start)), height);

  const peak = Math.max(1e-6, result.reference * 1.4);
  const bars = Math.min(width, samples.length);
  const per = samples.length / bars;
  for (let i = 0; i < bars; i += 1) {
    let value = 0;
    for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j += 1) value = Math.max(value, samples[j] ?? 0);
    const t = analysis.start + (i * per + per / 2) * analysis.frameDuration;
    const silent = result.silences.some((s) => t >= s.start && t <= s.end);
    const bar = Math.max(1, Math.min(1, value / peak) * (height - 4));
    context.fillStyle = silent ? muted : accent;
    context.fillRect((i / bars) * width, (height - bar) / 2, Math.max(1, width / bars - 0.5), bar);
  }
}
