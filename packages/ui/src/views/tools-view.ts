import type { JsonObject, PrimaryTransform, TransformChannel } from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { CommandButtons, Section, colorField, hint, numberField, pillGrid, row, segmented } from "../ui/controls.js";
import { h, setEnabled, setText, toggleClass } from "../ui/dom.js";

/**
 * TOOLS: layer utilities, switches, stacking order, and a live transform
 * inspector for the first selected layer.
 */

const TRANSFORM = "ADBE Transform Group";
const ROUNDING = 100;
const SEQUENCE_FRAMES = 5;
const FINE_STEP = 0.1;
/** Comp names listed under Duplicate Comp before "+N more". */
const NAMES_SHOWN = 3;

type ChannelKey = "anchor" | "position" | "scale" | "rotation" | "opacity";

interface InspectorField {
  readonly channel: ChannelKey;
  /** Component index within the channel's value. */
  readonly axis: number;
  readonly input: HTMLInputElement;
  readonly root: HTMLElement;
}

function round(value: number): string {
  return String(Math.round(value * ROUNDING) / ROUNDING);
}

export class ToolsView implements View {
  readonly id = "tools";
  readonly label = "Tools";
  readonly icon = "tab-tools";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #buttons: CommandButtons;
  readonly #sections: Section[] = [];
  readonly #fields: InspectorField[] = [];
  readonly #inspectorTitle: HTMLElement;
  readonly #inspectorBody: HTMLElement;
  readonly #inspectorEmpty: HTMLElement;
  readonly #linkScale: HTMLInputElement;
  #primary: PrimaryTransform | undefined;
  readonly #duplicateTarget: HTMLElement;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);
    const session = panel.session;
    const b = this.#buttons;

    // --- Layer -----------------------------------------------------------
    const layer = this.#section("tools.layer", "Layer");
    layer.body.append(
      pillGrid(
        b.button("kvfx.layer.precomposeeach", { label: "Precomp Each", icon: "precompose" }),
        b.button("kvfx.layer.split", { label: "Split", icon: "split" }),
        b.button("kvfx.layer.trimworkarea", { label: "Trim to WA", icon: "trim" }),
        b.button("kvfx.layer.nullparent", { label: "Null Parent", icon: "link" }),
        b.button("kvfx.label.selectsame", { label: "Same Label", icon: "select" }),
      ),
    );

    // --- Duplicate ---------------------------------------------------------
    // Its own section, spelled out: "duplicate with everything inside" is the
    // feature people look for by name, and a "Deep Dupe" pill hid it.
    this.#duplicateTarget = h("p", { class: "kvfx-hint kvfx-target" });
    const duplicate = this.#section("tools.duplicate", "Duplicate Comp", "with everything inside");
    duplicate.body.append(
      b.button("kvfx.comp.deepduplicatecomp", {
        label: "Duplicate Comp + Nested Comps",
        icon: "duplicate",
        variant: "wide",
        className: "kvfx-primary",
      }),
      this.#duplicateTarget,
      b.button("kvfx.comp.deepduplicate", { label: "Duplicate Precomp Layer + Nested", icon: "precompose", variant: "wide" }),
      hint("For a precomp layer selected in this timeline: the copy sits above it and uses its own comps."),
    );

    // --- Sequence ----------------------------------------------------------
    const seqParams = session.toolParams("sequence");
    let seqMode = seqParams["mode"] === "chain" ? "chain" : "offset";
    const frames = numberField("Step", typeof seqParams["frames"] === "number" ? seqParams["frames"] : SEQUENCE_FRAMES, {
      step: 1,
      unit: "fr",
      onChange: (value) => session.setToolParams("sequence", { frames: value }),
    });
    const mode = segmented(
      [
        { value: "offset", label: "Offset", title: "Stagger in-points by the step" },
        { value: "chain", label: "Chain", title: "Start each layer where the previous ends; the step is the gap" },
      ],
      seqMode,
      (value) => {
        seqMode = value;
        mode.set(value);
        session.setToolParams("sequence", { mode: value });
      },
    );
    const sequence = this.#section("tools.sequence", "Sequence", "top to bottom");
    sequence.body.append(
      row(frames.root, mode.root),
      b.button("kvfx.layer.sequence", {
        label: "Sequence Layers",
        icon: "sequence",
        variant: "wide",
        params: () => ({ frames: Number.parseFloat(frames.input.value) || 0, mode: seqMode }),
      }),
    );

    // --- Colour ------------------------------------------------------------
    const gradient = session.toolParams("gradient");
    const fillColor = colorField("Fill", session.state.settings.ui.solidColor);
    const gradFrom = colorField("From", typeof gradient["from"] === "string" ? gradient["from"] : "#ff8f3f", (hex) =>
      session.setToolParams("gradient", { from: hex }),
    );
    const gradTo = colorField("To", typeof gradient["to"] === "string" ? gradient["to"] : "#1f1a1a", (hex) =>
      session.setToolParams("gradient", { to: hex }),
    );
    let direction = typeof gradient["direction"] === "string" ? gradient["direction"] : "vertical";
    const dir = segmented(
      [
        { value: "vertical", label: "↓", title: "Top to bottom" },
        { value: "horizontal", label: "→", title: "Left to right" },
        { value: "diagonal", label: "↘", title: "Corner to corner" },
      ],
      direction,
      (value) => {
        direction = value;
        dir.set(value);
        session.setToolParams("gradient", { direction: value });
      },
    );
    const colour = this.#section("tools.colour", "Colour");
    colour.body.append(
      row(fillColor.root, b.button("kvfx.fx.fill", { label: "Fill", icon: "fill", params: () => ({ color: fillColor.input.value }) })),
      row(gradFrom.root, gradTo.root, dir.root),
      b.button("kvfx.fx.gradientlock", {
        label: "Gradient Lock",
        icon: "gradient",
        variant: "wide",
        params: () => ({ from: gradFrom.input.value, to: gradTo.input.value, direction }),
      }),
    );

    // --- Switches and order -------------------------------------------------
    const switches = this.#section("tools.switches", "Switches & Order");
    switches.body.append(
      h(
        "div",
        { class: "kvfx-toolrow" },
        b.button("kvfx.layer.solo", { label: "Solo", icon: "solo", variant: "tool" }),
        b.button("kvfx.layer.visibility", { label: "Visibility", icon: "eye", variant: "tool" }),
        b.button("kvfx.layer.lock", { label: "Lock", icon: "lock", variant: "tool" }),
        b.button("kvfx.layer.unlockall", { label: "Unlock all", icon: "unlock", variant: "tool" }),
        b.button("kvfx.layer.shy", { label: "Shy", icon: "shy", variant: "tool" }),
        b.button("kvfx.layer.threed", { label: "3D", icon: "cube", variant: "tool" }),
        b.button("kvfx.layer.guide", { label: "Guide", icon: "guide", variant: "tool" }),
        b.button("kvfx.layer.adjustment", { label: "Adjustment", icon: "adjustment", variant: "tool" }),
      ),
      h(
        "div",
        { class: "kvfx-toolrow" },
        b.button("kvfx.layer.movetop", { label: "Move to top", icon: "move-top", variant: "tool" }),
        b.button("kvfx.layer.moveup", { label: "Move up", icon: "move-up", variant: "tool" }),
        b.button("kvfx.layer.movedown", { label: "Move down", icon: "move-down", variant: "tool" }),
        b.button("kvfx.layer.movebottom", { label: "Move to bottom", icon: "move-bottom", variant: "tool" }),
      ),
    );

    // --- Transform inspector ---------------------------------------------
    this.#inspectorTitle = h("span", { class: "kvfx-inspector__layer" });
    this.#linkScale = h("input", { type: "checkbox", title: "Keep scale proportional" });
    this.#linkScale.checked = true;
    this.#inspectorEmpty = h("p", { class: "kvfx-empty", text: "No selection — select a layer to edit its transform." });
    this.#inspectorBody = h(
      "div",
      { class: "kvfx-inspector" },
      this.#inspectorTitle,
      this.#channelRow("Anchor", "anchor", ["X", "Y", "Z"]),
      this.#channelRow("Position", "position", ["X", "Y", "Z"]),
      this.#channelRow("Scale", "scale", ["W", "H", "D"], h("label", { class: "kvfx-link", title: "Keep scale proportional" }, this.#linkScale, createIcon("link", IconSize.small))),
      this.#channelRow("Rotation", "rotation", ["°"]),
      this.#channelRow("Opacity", "opacity", ["%"]),
      h("p", { class: "kvfx-hint", text: "Enter applies. Animated values get a keyframe at the playhead." }),
    );
    const inspector = this.#section("tools.inspector", "Transform");
    inspector.body.append(this.#inspectorEmpty, this.#inspectorBody);

    this.root = h("div", { class: "kvfx-tab" }, ...this.#sections.map((s) => s.root));
  }

  #section(id: string, title: string, hint?: string): Section {
    const section = new Section(this.#panel, id, title, hint);
    this.#sections.push(section);
    return section;
  }

  #channelRow(label: string, channel: ChannelKey, axes: readonly string[], extra?: HTMLElement): HTMLElement {
    const inputs = axes.map((axisLabel, axis) => {
      const field = numberField(axisLabel, 0, { step: channel === "opacity" ? 1 : FINE_STEP });
      field.input.addEventListener("change", () => void this.#commit(channel, axis, field.input));
      field.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") field.input.blur();
      });
      this.#fields.push({ channel, axis, input: field.input, root: field.root });
      return field.root;
    });
    const status = h("span", { class: "kvfx-keystate", attrs: { "data-channel": channel } });
    return h("div", { class: "kvfx-channel" }, h("span", { class: "kvfx-channel__label", text: label }), status, ...inputs, extra ?? null);
  }

  async #commit(channel: ChannelKey, axis: number, input: HTMLInputElement): Promise<void> {
    const primary = this.#primary;
    if (primary === undefined) return;
    const typed = Number.parseFloat(input.value);
    const current = primary[channel];
    if (!Number.isFinite(typed)) {
      input.value = round(current.value[axis] ?? 0);
      return;
    }

    const value = [...current.value];
    let args: JsonObject;
    if (channel === "position" && primary.positionSeparated) {
      // Separated dimensions are three independent properties.
      args = { path: [TRANSFORM, `ADBE Position_${String(axis)}`], value: typed };
    } else if (value.length === 1) {
      args = { path: [TRANSFORM, matchNameFor(channel)], value: typed };
    } else {
      if (channel === "scale" && this.#linkScale.checked && (value[axis] ?? 0) !== 0) {
        const factor = typed / (value[axis] ?? 1);
        for (let i = 0; i < value.length && i < 2; i += 1) value[i] = (value[i] ?? 0) * factor;
      }
      value[axis] = typed;
      args = { path: [TRANSFORM, matchNameFor(channel)], value: value };
    }

    await this.#panel.session.runPlan(`Set ${channel}`, [
      { op: "kvfx.op.prop.set", args: { ids: [primary.id], whenAnimated: "keyframe", ...args } },
    ]);
  }

  update(state: SessionState, availability: Availability): void {
    for (const section of this.#sections) section.update(state);
    this.#buttons.update(state, availability);
    this.#updateInspector(state);
    this.#updateDuplicateTarget(state);
  }

  /** Says what "Duplicate Comp" will copy, so the Project-panel rule is visible. */
  #updateDuplicateTarget(state: SessionState): void {
    const { projectComps, comp } = state.snapshot;
    let text: string;
    if (projectComps.length > 0) {
      const names = projectComps.slice(0, NAMES_SHOWN).map((c) => c.name).join(", ");
      const more = projectComps.length > NAMES_SHOWN ? ` +${String(projectComps.length - NAMES_SHOWN)} more` : "";
      text = `Will copy: ${names}${more} — selected in the Project panel.`;
    } else if (comp !== undefined) {
      text = `Will copy: ${comp.name} — the open comp. Select comps in the Project panel to copy those instead.`;
    } else {
      text = "Select a comp in the Project panel, or open one.";
    }
    setText(this.#duplicateTarget, text);
  }

  #updateInspector(state: SessionState): void {
    const primary = state.snapshot.primary;
    this.#primary = primary;
    this.#inspectorBody.hidden = primary === undefined;
    this.#inspectorEmpty.hidden = primary !== undefined;
    if (primary === undefined) return;

    const layer = state.snapshot.layers.find((l) => l.id === primary.id);
    const extra = state.snapshot.layers.length > 1 ? ` (+${String(state.snapshot.layers.length - 1)} more)` : "";
    setText(this.#inspectorTitle, `${layer?.name ?? "Layer"}${extra}`);

    const threeD = layer?.threeD === true;
    for (const field of this.#fields) {
      const channel: TransformChannel = primary[field.channel];
      // Depth only means something on a 3D layer.
      field.root.hidden = field.axis === 2 && !threeD;
      const editing = document.activeElement === field.input;
      if (!editing) field.input.value = round(channel.value[field.axis] ?? 0);
      const locked = layer?.locked === true;
      const reason = channel.expression ? "Driven by an expression" : locked ? "Layer is locked" : undefined;
      setEnabled(field.input, reason === undefined && !state.busy, reason);
    }
    for (const status of Array.from(this.#inspectorBody.querySelectorAll<HTMLElement>(".kvfx-keystate"))) {
      const key = status.dataset["channel"] as ChannelKey;
      const channel = primary[key];
      toggleClass(status, "kvfx-keystate--keyed", channel.animated);
      toggleClass(status, "kvfx-keystate--expr", channel.expression);
      status.title = channel.expression ? "Expression" : channel.animated ? "Animated — edits add a keyframe" : "";
    }
  }
}

function matchNameFor(channel: ChannelKey): string {
  switch (channel) {
    case "anchor":
      return "ADBE Anchor Point";
    case "position":
      return "ADBE Position";
    case "scale":
      return "ADBE Scale";
    case "rotation":
      return "ADBE Rotate Z";
    case "opacity":
      return "ADBE Opacity";
  }
}
