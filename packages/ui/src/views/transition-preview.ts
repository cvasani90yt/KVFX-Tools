import { type Rgb, type TransitionPose, type TransitionPreset, transitionPose } from "@kvfx/core";

/**
 * The Transitions section's live preview.
 *
 * It plays the preset between two stand-in shots, posed by `transitionPose`
 * — the same channels the layer's expressions run — so what moves here is
 * what moves in the comp. The rendering is a canvas sketch of the effects:
 * blur is a blur, but a twirl or a turbulent displace is approximated with
 * a few slices, which is enough to tell the presets apart at a glance.
 */

/* eslint-disable no-magic-numbers -- drawing proportions and timings are the content */

const COMP_W = 1920;
const COMP_H = 1080;
const FPS = 25;
/** Slower than real time, so a 12-frame cut can be read. */
const SLOW = 1.8;
const HOLD_MS = 450;
/** Sub-frames drawn for the Transform effect's motion blur. */
const BLUR_SAMPLES = 5;
const MS = 1000;

const css = (rgb: Rgb, alpha = 1): string =>
  `rgba(${String(Math.round(rgb[0] * 255))}, ${String(Math.round(rgb[1] * 255))}, ${String(Math.round(rgb[2] * 255))}, ${String(alpha)})`;

/** A stand-in shot: a gradient sky, a horizon, a big letter and a grid that shows motion. */
function shot(w: number, h: number, letter: string, top: string, bottom: string, sun: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (g === null) return canvas;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bottom);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255, 255, 255, 0.12)";
  g.lineWidth = Math.max(1, w / 240);
  for (let x = 0; x <= w; x += w / 8) {
    g.beginPath();
    g.moveTo(x, h * 0.62);
    g.lineTo(w / 2 + (x - w / 2) * 2.2, h);
    g.stroke();
  }
  g.fillStyle = "rgba(0, 0, 0, 0.25)";
  g.fillRect(0, h * 0.62, w, h * 0.38);
  g.fillStyle = sun;
  g.beginPath();
  g.arc(w * 0.74, h * 0.36, h * 0.16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255, 255, 255, 0.92)";
  g.font = `800 ${String(Math.round(h * 0.42))}px Inter, "Segoe UI", sans-serif`;
  g.textBaseline = "middle";
  g.fillText(letter, w * 0.12, h * 0.42);
  return canvas;
}

export interface PreviewSettings {
  readonly strength: number;
  readonly frames: number;
  readonly color: Rgb;
}

export class TransitionPreview {
  readonly #canvas: HTMLCanvasElement;
  readonly #settings: () => PreviewSettings;
  #preset: TransitionPreset | undefined;
  #shots: [HTMLCanvasElement, HTMLCanvasElement] | undefined;
  #work: HTMLCanvasElement = document.createElement("canvas");
  #tiny: HTMLCanvasElement = document.createElement("canvas");
  #started = 0;
  #frame = 0;
  #seed = 3;

  constructor(canvas: HTMLCanvasElement, settings: () => PreviewSettings) {
    this.#canvas = canvas;
    this.#settings = settings;
  }

  /** Plays `preset` on a loop, from the start, while the preview is on screen. */
  play(preset: TransitionPreset): void {
    if (preset !== this.#preset) this.#seed = 1 + Math.floor(Math.random() * 999);
    this.#preset = preset;
    this.#started = performance.now();
    if (this.#frame === 0) this.#frame = requestAnimationFrame((now) => this.#tick(now));
  }

  #tick(now: number): void {
    this.#frame = 0;
    if (!this.#canvas.isConnected || document.hidden || this.#canvas.offsetParent === null || this.#preset === undefined) return;
    const settings = this.#settings();
    const length = (Math.max(2, settings.frames) / FPS) * MS * SLOW;
    const cycle = (now - this.#started) % (length + 2 * HOLD_MS);
    const t = Math.min(1, Math.max(0, (cycle - HOLD_MS) / length));
    this.#draw(this.#preset, t, settings);
    this.#frame = requestAnimationFrame((next) => this.#tick(next));
  }

  #fit(): CanvasRenderingContext2D | null {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(32, Math.round(this.#canvas.clientWidth * ratio));
    const h = Math.round((w * COMP_H) / COMP_W);
    if (this.#canvas.width !== w || this.#canvas.height !== h || this.#shots === undefined) {
      this.#canvas.width = w;
      this.#canvas.height = h;
      this.#work.width = w;
      this.#work.height = h;
      this.#shots = [shot(w, h, "A", "#ffb36b", "#7a2e1a", "#fff1c9"), shot(w, h, "B", "#5fb7d9", "#1b2a55", "#d7f3ff")];
    }
    return this.#canvas.getContext("2d");
  }

  #draw(preset: TransitionPreset, t: number, settings: PreviewSettings): void {
    const out = this.#fit();
    const work = this.#work.getContext("2d");
    if (out === null || work === null || this.#shots === undefined) return;
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const k = w / COMP_W;
    const options = { s: settings.strength / 100, seed: this.#seed, frames: settings.frames, color: settings.color };
    const pose = transitionPose(preset, t, options);
    const source = t < 0.5 ? this.#shots[0] : this.#shots[1];

    work.setTransform(1, 0, 0, 1, 0, 0);
    work.globalAlpha = 1;
    work.filter = "none";
    work.clearRect(0, 0, w, h);
    if (pose.kind === "adjust") {
      // The Transform effect's motion blur: a few poses either side of this one.
      const span = (options.s * 240) / 360 / Math.max(2, settings.frames);
      const moving = preset.build.kind === "adjust" && preset.build.effects.some((e) => e.matchName === "ADBE Geometry2");
      const samples = moving && span > 0 ? BLUR_SAMPLES : 1;
      for (let i = 0; i < samples; i += 1) {
        const at = samples === 1 ? t : t + span * (i / (samples - 1) - 0.5);
        const p = samples === 1 ? pose : transitionPose(preset, Math.min(1, Math.max(0, at)), options);
        work.globalAlpha = 1 / (i + 1);
        this.#placed(work, source, p, w, h, k);
      }
      work.globalAlpha = 1;
      this.#effects(work, pose, w, h, k);
    } else {
      work.drawImage(source, 0, 0);
    }

    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = "source-over";
    out.globalAlpha = 1;
    out.filter = "none";
    out.clearRect(0, 0, w, h);
    out.drawImage(this.#work, 0, 0);
    if (pose.solid !== undefined) this.#solid(out, preset, pose, w, h, k);
    this.#shapes(out, pose, w, h, k);
  }

  /** The shot moved, scaled and turned like the Transform effect, with Motion Tile copies around it. */
  #placed(g: CanvasRenderingContext2D, source: HTMLCanvasElement, pose: TransitionPose, w: number, h: number, k: number): void {
    const blur = (pose.amounts["ADBE Gaussian Blur 2-0001"] ?? 0) * k * 0.6;
    const lens = 1 + (pose.amounts["ADBE Optics Compensation-0001"] ?? 0) / 300;
    g.save();
    g.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : "none";
    g.translate(w / 2 + pose.x * k, h / 2 + pose.y * k);
    g.rotate((pose.rotation * Math.PI) / 180);
    g.scale((pose.scaleX / 100) * lens, (pose.scaleY / 100) * lens);
    const reach = pose.tiled ? 2 : 0;
    for (let ix = -reach; ix <= reach; ix += 1) {
      for (let iy = -reach; iy <= reach; iy += 1) g.drawImage(source, -w / 2 + ix * w, -h / 2 + iy * h);
    }
    g.restore();
  }

  /** Sketches of the distortions, the glitch and the tone changes, over the placed shot. */
  #effects(g: CanvasRenderingContext2D, pose: TransitionPose, w: number, h: number, k: number): void {
    const a = pose.amounts;
    const twirl = a["ADBE Twirl-0001"] ?? 0;
    if (Math.abs(twirl) > 1) {
      // Rings turned a little more toward the middle.
      const copy = this.#snapshot(w, h);
      for (let ring = 1; ring <= 8; ring += 1) {
        const r = (Math.min(w, h) * 0.5 * (9 - ring)) / 8;
        g.save();
        g.beginPath();
        g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        g.clip();
        g.translate(w / 2, h / 2);
        g.rotate((twirl * ring * 0.1 * Math.PI) / 180);
        g.drawImage(copy, -w / 2, -h / 2);
        g.restore();
      }
    }
    const wave = a["ADBE Wave Warp-0002"] ?? 0;
    const displace = a["ADBE Turbulent Displace-0002"] ?? 0;
    if (wave > 0.5 || displace > 0.5) {
      const copy = this.#snapshot(w, h);
      const square = (a["ADBE Wave Warp-0001"] ?? 1) === 2;
      const width = (a["ADBE Wave Warp-0003"] ?? 160) * k;
      const phase = ((a["ADBE Wave Warp-0007"] ?? 0) * Math.PI) / 180 + performance.now() / 300;
      const slice = Math.max(2, Math.round(h / 40));
      g.clearRect(0, 0, w, h);
      for (let y = 0; y < h; y += slice) {
        const wave1 = Math.sin((y / Math.max(1, width)) * Math.PI * 2 + phase);
        let dx = (square ? Math.sign(wave1) : wave1) * wave * k;
        dx += Math.sin(y * 0.11 + phase * 0.7) * displace * k * 0.6;
        g.drawImage(copy, 0, y, w, slice, dx, y, w, slice);
      }
    }
    const mix = a["ADBE Mosaic mix"];
    const blocks = a["ADBE Mosaic-0001"];
    if (blocks !== undefined && (mix ?? 100) > 0) {
      const bw = Math.max(2, Math.round((blocks / COMP_W) * w * 0.35));
      const bh = Math.max(2, Math.round((bw * h) / w));
      this.#tiny.width = bw;
      this.#tiny.height = bh;
      const tiny = this.#tiny.getContext("2d");
      if (tiny !== null && bw < w / 2) {
        tiny.drawImage(this.#work, 0, 0, bw, bh);
        g.imageSmoothingEnabled = false;
        g.drawImage(this.#tiny, 0, 0, w, h);
        g.imageSmoothingEnabled = true;
      }
    }
    const red = a["ADBE Channel Blur-0001"] ?? 0;
    if (red > 0.5) {
      const copy = this.#snapshot(w, h);
      g.save();
      g.globalCompositeOperation = "screen";
      g.globalAlpha = Math.min(0.6, red / 60);
      g.filter = "sepia(1) saturate(8) hue-rotate(-40deg)";
      g.drawImage(copy, -red * k * 0.5, 0);
      g.filter = "sepia(1) saturate(8) hue-rotate(170deg)";
      g.drawImage(copy, red * k * 0.35, 0);
      g.restore();
    }
    const invert = a["ADBE Invert-0002"];
    const brightness = a["ADBE Brightness & Contrast 2-0001"] ?? 0;
    const contrast = a["ADBE Brightness & Contrast 2-0002"] ?? 0;
    const filters: string[] = [];
    if (invert !== undefined && invert < 50) filters.push("invert(1)");
    if (Math.abs(brightness) > 0.5 || Math.abs(contrast) > 0.5) filters.push(`brightness(${(1 + brightness / 100).toFixed(2)}) contrast(${(1 + contrast / 100).toFixed(2)})`);
    if (filters.length > 0) {
      const copy = this.#snapshot(w, h);
      g.save();
      g.clearRect(0, 0, w, h);
      g.filter = filters.join(" ");
      g.drawImage(copy, 0, 0);
      g.restore();
    }
    const noise = a["ADBE Noise-0001"] ?? 0;
    if (noise > 1) {
      g.save();
      g.globalAlpha = Math.min(0.5, noise / 120);
      for (let i = 0; i < 160; i += 1) {
        g.fillStyle = i % 2 === 0 ? "#ffffff" : "#000000";
        g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
      }
      g.restore();
    }
  }

  #solid(g: CanvasRenderingContext2D, preset: TransitionPreset, pose: TransitionPose, w: number, h: number, k: number): void {
    const solid = pose.solid;
    if (solid === undefined || solid.opacity <= 0) return;
    g.save();
    g.globalCompositeOperation = solid.blend === "add" ? "lighter" : solid.blend === "screen" ? "screen" : "source-over";
    g.globalAlpha = Math.min(1, solid.opacity / 100);
    if (solid.points === undefined || preset.build.kind !== "solid") {
      g.fillStyle = css(solid.color);
      g.fillRect(0, 0, w, h);
    } else {
      // A light leak: soft pools of each gradient colour at its point.
      const colours = preset.build.effects
        .flatMap((e) => e.params)
        .map((p) => p.value)
        .filter((v): v is number[] => Array.isArray(v) && v.length === 4)
        .map((v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] as Rgb);
      solid.points.forEach(([px, py], i) => {
        const colour = colours[i];
        if (colour === undefined || colour[0] + colour[1] + colour[2] === 0) return;
        const x = w / 2 + px * k;
        const y = h / 2 + py * k;
        const r = w * 0.55;
        const pool = g.createRadialGradient(x, y, 0, x, y, r);
        pool.addColorStop(0, css(colour, 0.9));
        pool.addColorStop(1, css(colour, 0));
        g.fillStyle = pool;
        g.fillRect(0, 0, w, h);
      });
    }
    g.restore();
  }

  #shapes(g: CanvasRenderingContext2D, pose: TransitionPose, w: number, h: number, k: number): void {
    // Shape groups draw bottom first; the first group in the list is on top.
    for (const s of [...pose.shapes].reverse()) {
      if (s.opacity <= 0 || s.scaleX <= 0 || s.scaleY <= 0) continue;
      g.save();
      g.globalAlpha = Math.min(1, s.opacity / 100);
      g.translate(w / 2 + s.x * k, h / 2 + s.y * k);
      g.rotate((s.rotation * Math.PI) / 180);
      g.scale(s.scaleX / 100, s.scaleY / 100);
      const sw = s.size[0] * k;
      const sh = s.size[1] * k;
      g.beginPath();
      if (s.type === "ellipse") g.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2);
      else g.rect(-sw / 2, -sh / 2, sw, sh);
      if (s.stroke === undefined) {
        g.fillStyle = css(s.color);
        g.fill();
      } else {
        g.strokeStyle = css(s.color);
        g.lineWidth = (s.stroke * k) / Math.max(0.01, s.scaleX / 100);
        g.stroke();
      }
      g.restore();
    }
  }

  /** A copy of the work canvas as it stands, to draw back from. */
  #snapshot(w: number, h: number): HTMLCanvasElement {
    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    copy.getContext("2d")?.drawImage(this.#work, 0, 0);
    return copy;
  }
}
