import { type JsonValue, KINETIC_ASPECTS, KINETIC_STYLES } from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import { type CommandButtons, type Section, colorField, hint, numberField, row, segmented, selectField, textField } from "../ui/controls.js";
import { h, toggleClass } from "../ui/dom.js";

/**
 * Text ▸ Kinetic Title: a phrase as animated big type, with starred words in
 * accent colours, in this comp or a new one at a social size.
 */

type MakeSection = (id: string, title: string, hintText?: string) => Section;

export function buildKineticSection(panel: Panel, buttons: CommandButtons, section: MakeSection): void {
  const session = panel.session;
  const p = session.toolParams("kinetic");
  const str = (key: string, fallback: string): string => {
    const value = p[key];
    return typeof value === "string" ? value : fallback;
  };

  const text = textField("Phrase", str("text", "Make *videos* that *stop* the scroll"), undefined, "Star words for colour: *like this*");
  let style = str("style", "stack");
  const tiles = h("div", { class: "kvfx-tiles" });
  const tileButtons = KINETIC_STYLES.map((option) => {
    const tile = h("button", {
      class: "kvfx-tile",
      type: "button",
      text: option.label,
      title: option.title,
      on: {
        click: () => {
          style = option.id;
          paint();
        },
      },
    });
    tiles.append(tile);
    return { id: option.id, tile };
  });
  const paint = (): void => {
    for (const { id, tile } of tileButtons) toggleClass(tile, "kvfx-tile--on", id === style);
  };
  paint();

  const color = colorField("Type", str("color", "#ffffff"));
  const accent = colorField("Accent", str("accent", "#ff8f3f"));
  const accent2 = colorField("Accent 2", str("accent2", "#fbbf24"));
  let background = str("background", "none");
  const backgroundSeg = segmented(
    [
      { value: "none", label: "No BG" },
      { value: "solid", label: "Solid" },
      { value: "drift", label: "Drift", title: "A slow gradient in your accents" },
    ],
    background,
    (value) => {
      background = value;
      backgroundSeg.set(value);
    },
  );
  const backgroundColor = colorField("BG", str("backgroundColor", "#0f0f14"));
  const aspect = selectField(
    "Size",
    KINETIC_ASPECTS.map((a) => ({ value: a.id, label: a.id === "comp" ? a.label : `New ${a.label} comp` })),
    str("aspect", "comp"),
  );
  const speed = numberField("Speed", typeof p["speed"] === "number" ? p["speed"] : 1, { min: 0.1, max: 10, step: 0.25, unit: "×" });

  section("text.kinetic", "Kinetic Title", "big type").body.append(
    text.root,
    tiles,
    row(color.root, accent.root, accent2.root),
    row(backgroundSeg.root, backgroundColor.root),
    row(aspect.root, speed.root),
    buttons.button("kvfx.rig.kinetic", {
      label: "Build Kinetic Title",
      icon: "kinetic",
      variant: "wide",
      params: () => {
        const params: Record<string, JsonValue> = {
          text: text.input.value,
          style,
          color: color.input.value,
          accent: accent.input.value,
          accent2: accent2.input.value,
          background,
          backgroundColor: backgroundColor.input.value,
          aspect: aspect.select.value,
          speed: Number(speed.input.value) || 1,
        };
        session.setToolParams("kinetic", params);
        return params;
      },
    }),
    hint("Type fits the frame. Each line stays live text — restyle it with Style above. A new size opens as its own comp."),
  );
}
