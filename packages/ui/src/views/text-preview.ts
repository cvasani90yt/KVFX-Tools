import {
  type HiddenState,
  type TextMotionOptions,
  easeValue,
  maxRank,
  resolveEase,
  rgbToHex,
  staggerRanks,
} from "@kvfx/core";
import { clear, h } from "../ui/dom.js";

/**
 * The Animate section's live preview.
 *
 * It plays the same motion the composition will get: units split the way the
 * selector will count them, ranked by the same order function, eased by the
 * same maths as the expression (`easeValue`). Only the rendering differs —
 * CSS here, text animators there.
 */

const OPACITY_SCALE = 100;
const SCALE_PERCENT = 100;
/** After Effects blur radius reads stronger than CSS blur; this keeps the preview honest. */
const BLUR_RATIO = 4;
/** Tracking is in thousandths of an em; at the preview's 22px that is about 1/40 px per unit. */
const TRACKING_RATIO = 40;
const SAMPLES = 24;
const HOLD_MS = 700;
const PAUSE_MS = 900;
const MS = 1000;
const SCRAMBLE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=?";
const MAX_CHARS = 24;
/** Below these an accent tint is too faint to be worth drawing. */
const TINT_MIN = 0.02;
const BAND_MIN = 0.15;
const MIN_STEP_S = 0.001;
/** Typing with no stagger types the word in a tenth of a unit's duration per character. */
const TYPING_SHARE = 10;

interface Unit {
  readonly node: HTMLElement;
  readonly text: string;
  rank: number;
}

function styleFor(hidden: HiddenState, amount: number): Keyframe {
  const a = amount;
  const transforms: string[] = [];
  if (hidden.x !== undefined || hidden.y !== undefined) {
    transforms.push(`translate(${String((hidden.x ?? 0) * a)}px, ${String((hidden.y ?? 0) * a)}px)`);
  }
  if (hidden.scale !== undefined || hidden.scaleX !== undefined || hidden.scaleY !== undefined) {
    const sx = (hidden.scaleX ?? hidden.scale ?? SCALE_PERCENT) / SCALE_PERCENT;
    const sy = (hidden.scaleY ?? hidden.scale ?? SCALE_PERCENT) / SCALE_PERCENT;
    transforms.push(`scale(${String(1 + (sx - 1) * a)}, ${String(1 + (sy - 1) * a)})`);
  }
  if (hidden.rotation !== undefined) transforms.push(`rotate(${String(hidden.rotation * a)}deg)`);
  if (hidden.skew !== undefined) transforms.push(`skewX(${String(-hidden.skew * a)}deg)`);
  const opacity = hidden.opacity === undefined ? 1 : 1 + (hidden.opacity / OPACITY_SCALE - 1) * a;
  return {
    opacity: String(Math.max(0, Math.min(1, opacity))),
    transform: transforms.length > 0 ? transforms.join(" ") : "none",
    filter: `blur(${String(Math.max(0, ((hidden.blur ?? 0) * a) / BLUR_RATIO))}px)`,
    marginRight: `${String(((hidden.tracking ?? 0) * a) / TRACKING_RATIO)}px`,
  };
}

export class TextPreview {
  readonly #stage: HTMLElement;
  #animations: Animation[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #frame = 0;

  constructor(stage: HTMLElement) {
    this.#stage = stage;
  }

  stop(): void {
    for (const animation of this.#animations) animation.cancel();
    this.#animations = [];
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** Plays `options` on `sample`, looping until stopped. Times are in seconds, as in After Effects. */
  play(sample: string, options: TextMotionOptions): void {
    this.stop();
    if (!this.#stage.isConnected) return;
    const text = (sample.trim() || "Your title").slice(0, MAX_CHARS);
    const kind = options.preset.kind;
    if (kind === "typing") {
      this.#playTyping(text, options);
      return;
    }
    const units = this.#split(text, options);
    if (kind === "state") this.#playState(units, options);
    else this.#playFramewise(units, options);
  }

  #split(text: string, options: TextMotionOptions): Unit[] {
    clear(this.#stage);
    const units: Unit[] = [];
    if (options.unit === "characters") {
      for (const ch of Array.from(text)) {
        // An en space: a plain one between bold inline-blocks reads as no gap at all.
        const node = h("span", { class: "kvfx-stage__char", text: ch === " " ? "\u2002" : ch });
        this.#stage.append(node);
        // Spaces do not take a turn, as in After Effects' "characters excluding spaces".
        if (ch !== " ") units.push({ node, text: ch, rank: 0 });
      }
    } else if (options.unit === "words") {
      text.split(/(\s+)/).forEach((part) => {
        if (part.length === 0) return;
        if (/^\s+$/.test(part)) {
          this.#stage.append(h("span", { text: "\u2002" }));
          return;
        }
        const node = h("span", { class: "kvfx-stage__char", text: part });
        this.#stage.append(node);
        units.push({ node, text: part, rank: 0 });
      });
    } else {
      const node = h("span", { class: "kvfx-stage__char", text });
      this.#stage.append(node);
      units.push({ node, text, rank: 0 });
    }
    const ranks = staggerRanks(units.length, options.order, options.seed);
    units.forEach((unit, i) => {
      unit.rank = ranks[i] ?? i;
    });
    return units;
  }

  #timing(units: readonly Unit[], options: TextMotionOptions): { stagger: number; duration: number; total: number } {
    const stagger = options.stagger * MS;
    const duration = options.duration * MS;
    return { stagger, duration, total: maxRank(units.length, options.order) * stagger + duration };
  }

  #loop(after: number, units: readonly Unit[], options: TextMotionOptions): void {
    this.#timer = setTimeout(() => {
      const sample = units.map((u) => u.text).join(options.unit === "words" ? " " : "");
      this.play(sample, options);
    }, after);
  }

  #playState(units: readonly Unit[], options: TextMotionOptions): void {
    const ease = resolveEase(options);
    const { stagger, duration, total } = this.#timing(units, options);
    const hidden = options.preset.hidden;
    const curve = (out: boolean): Keyframe[] =>
      Array.from({ length: SAMPLES + 1 }, (_, i) => {
        const e = easeValue(ease, i / SAMPLES, options.overshoot, options.bezier);
        return { ...styleFor(hidden, out ? e : 1 - e), offset: i / SAMPLES };
      });

    const doIn = options.mode !== "out";
    const doOut = options.mode !== "in";
    const outAt = doIn ? total + HOLD_MS : 0;
    for (const unit of units) {
      const delay = unit.rank * stagger;
      if (doIn) {
        this.#animations.push(unit.node.animate(curve(false), { duration, delay, fill: "both" }));
      }
      if (doOut) {
        const animation = unit.node.animate(curve(true), { duration, delay: outAt + delay, fill: doIn ? "forwards" : "both" });
        this.#animations.push(animation);
      }
    }
    this.#loop(outAt + (doOut ? total : 0) + PAUSE_MS, units, options);
  }

  /** Scramble, colour typing and highlight change per frame, so they are drawn by hand. */
  #playFramewise(units: readonly Unit[], options: TextMotionOptions): void {
    const ease = resolveEase(options);
    const { stagger, duration, total } = this.#timing(units, options);
    const accent = rgbToHex(options.accent);
    const kind = options.preset.kind;
    const fades = options.preset.hidden.opacity !== undefined;
    const started = performance.now();
    const end = total + (kind === "colorType" ? duration : 0);

    const draw = (now: number): void => {
      if (!this.#stage.isConnected) return;
      const t = now - started;
      for (const unit of units) {
        const p = (t - unit.rank * stagger) / duration;
        const node = unit.node;
        if (kind === "scramble") {
          const settled = p >= 1;
          node.textContent = settled ? unit.text : (SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)] ?? "#");
          node.style.opacity = fades && p <= 0 ? "0" : "1";
        } else if (kind === "colorType") {
          node.style.opacity = p > 0 ? "1" : "0";
          const mix = p > 0 ? Math.max(0, 1 - easeValue(ease, p, options.overshoot, options.bezier)) : 1;
          node.style.color = mix > TINT_MIN ? accent : "";
        } else {
          const band = p > 0 && p < 1 ? Math.sin(Math.PI * easeValue(ease, p, options.overshoot, options.bezier)) : 0;
          node.style.color = band > BAND_MIN ? accent : "";
        }
      }
      if (t < end + HOLD_MS) this.#frame = requestAnimationFrame(draw);
      else this.#loop(PAUSE_MS, units, options);
    };
    this.#frame = requestAnimationFrame(draw);
  }

  #playTyping(text: string, options: TextMotionOptions): void {
    clear(this.#stage);
    const node = h("span", { class: "kvfx-stage__type" });
    this.#stage.append(node);
    const perChar = Math.max(MIN_STEP_S, options.stagger > 0 ? options.stagger : options.duration / TYPING_SHARE) * MS;
    const started = performance.now();
    const typeEnd = text.length * perChar;
    const deleteAt = typeEnd + HOLD_MS * 2;
    const draw = (now: number): void => {
      if (!this.#stage.isConnected) return;
      const t = now - started;
      let shown = text.length;
      if (options.mode !== "out") shown = Math.min(text.length, Math.floor(t / perChar));
      if (options.mode === "out") shown = Math.max(0, text.length - Math.floor(t / perChar));
      if (options.mode === "inOut" && t > deleteAt) shown = Math.max(0, text.length - Math.floor((t - deleteAt) / perChar));
      const blink = Math.floor(t / (MS / 2)) % 2 === 0;
      const busy = shown > 0 && shown < text.length;
      node.textContent = text.slice(0, shown) + (busy || blink ? "|" : "\u00a0");
      const end = options.mode === "inOut" ? deleteAt + typeEnd : typeEnd;
      if (t < end + HOLD_MS * 2) this.#frame = requestAnimationFrame(draw);
      else this.#timer = setTimeout(() => this.play(text, options), PAUSE_MS);
    };
    this.#frame = requestAnimationFrame(draw);
  }
}
