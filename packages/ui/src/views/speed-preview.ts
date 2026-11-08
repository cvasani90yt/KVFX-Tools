import { type SpeedPreset, speedPose } from "@kvfx/core";

/**
 * The Speed Ramp section's live preview.
 *
 * A stand-in shot — a ball bouncing past a scrolling street — is drawn at the
 * source time the ramp plays, so slow motion, freezes and rewinds read as
 * they would on a clip. Underneath, the speed graph across the ramp with a
 * playhead, and the speed now. Both come from `speedPose`, the same maths as
 * the layer's Time Remap expression.
 */

/* eslint-disable no-magic-numbers -- drawing proportions and timings are the content */

const FPS = 25;
/** Normal-speed footage either side of the ramp, in seconds. */
const LEAD = 0.7;
const HOLD_MS = 350;
const MS = 1000;
/** Bounces per second of footage. */
const BOUNCE = 1.6;
/** The graph's top speed; faster draws at the top edge. */
const TOP_SPEED = 6;
const TRAIL = 5;

export interface SpeedPreviewSettings {
  readonly strength: number;
  readonly frames: number;
}

const ACCENT = "#ff8f3f";

/** Signed log scale: 1× sits low, 0 on the zero line, reverse below it. */
const level = (v: number): number => (Math.sign(v) * Math.log2(1 + Math.abs(v))) / Math.log2(1 + TOP_SPEED);

export class SpeedPreview {
  readonly #canvas: HTMLCanvasElement;
  readonly #settings: () => SpeedPreviewSettings;
  #preset: SpeedPreset | undefined;
  #started = 0;
  #frame = 0;

  constructor(canvas: HTMLCanvasElement, settings: () => SpeedPreviewSettings) {
    this.#canvas = canvas;
    this.#settings = settings;
  }

  /** Plays `preset` on a loop, from the start, while the preview is on screen. */
  play(preset: SpeedPreset): void {
    this.#preset = preset;
    this.#started = performance.now();
    if (this.#frame === 0) this.#frame = requestAnimationFrame((now) => this.#tick(now));
  }

  #tick(now: number): void {
    this.#frame = 0;
    if (!this.#canvas.isConnected || document.hidden || this.#canvas.offsetParent === null || this.#preset === undefined) return;
    const settings = this.#settings();
    const ramp = Math.max(2, settings.frames) / FPS;
    const total = ramp + 2 * LEAD;
    const cycle = ((now - this.#started) % (total * MS + HOLD_MS)) / MS;
    this.#draw(this.#preset, Math.min(total, cycle), ramp, settings.strength / 100);
    this.#frame = requestAnimationFrame((next) => this.#tick(next));
  }

  #fit(): CanvasRenderingContext2D | null {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(32, Math.round(this.#canvas.clientWidth * ratio));
    const h = Math.round((w * 9) / 16);
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
    return this.#canvas.getContext("2d");
  }

  /** Source time and speed at demo time `t`: normal, the ramp, normal again. */
  #at(preset: SpeedPreset, t: number, ramp: number, s: number): { source: number; speed: number } {
    if (t <= LEAD) return { source: t, speed: 1 };
    if (t >= LEAD + ramp) return { source: LEAD + ramp * speedPose(preset, 1, s).advance + (t - LEAD - ramp), speed: 1 };
    const pose = speedPose(preset, (t - LEAD) / ramp, s);
    return { source: LEAD + ramp * pose.advance, speed: pose.speed };
  }

  #draw(preset: SpeedPreset, t: number, ramp: number, s: number): void {
    const g = this.#fit();
    if (g === null) return;
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const now = this.#at(preset, t, ramp, s);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    this.#scene(g, w, h, now.source, now.speed);
    this.#readout(g, w, h, now.speed);
    this.#graph(g, preset, w, h, t, ramp, s);
  }

  /** The shot at source time `source`: sky, skyline, street and a bouncing ball with a speed trail. */
  #scene(g: CanvasRenderingContext2D, w: number, h: number, source: number, speed: number): void {
    // The graph covers the bottom quarter, so the street and the bounce sit above it.
    const horizon = h * 0.42;
    const ground = h * 0.62;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#1b2a55");
    sky.addColorStop(1, "#5fb7d9");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, horizon);
    // Far skyline drifts slowly; the street rushes past.
    g.fillStyle = "rgba(10, 20, 44, 0.55)";
    const far = (source * w * 0.06) % (w / 5);
    for (let i = -1; i < 7; i += 1) {
      const x = i * (w / 5) - far;
      const tall = h * (0.1 + 0.08 * (((i % 3) + 3) % 3));
      g.fillRect(x, horizon - tall, w / 7, tall);
    }
    g.fillStyle = "#2a2e37";
    g.fillRect(0, horizon, w, h - horizon);
    g.fillStyle = "rgba(255, 255, 255, 0.5)";
    const dash = w / 6;
    const near = (((source * w * 0.55) % dash) + dash) % dash;
    for (let x = -dash; x < w + dash; x += dash) g.fillRect(x - near, ground + h * 0.035, dash * 0.5, Math.max(2, h * 0.012));

    const ballR = h * 0.075;
    const bx = w * 0.36;
    const ballAt = (src: number): number => ground - ballR - Math.abs(Math.sin(Math.PI * BOUNCE * src)) * h * 0.28;
    // A trail when the footage plays fast, the way a fast ramp smears.
    const smear = Math.min(1, Math.max(0, (Math.abs(speed) - 1.2) / 3));
    if (smear > 0) {
      for (let i = TRAIL; i >= 1; i -= 1) {
        g.globalAlpha = (0.35 * smear) / i;
        g.fillStyle = ACCENT;
        g.beginPath();
        g.arc(bx - Math.sign(speed) * i * ballR * 0.5, ballAt(source - (speed * i) / (FPS * 2)), ballR, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = "rgba(0, 0, 0, 0.3)";
    g.beginPath();
    g.ellipse(bx, ground + ballR * 0.15, ballR * 1.1, ballR * 0.25, 0, 0, Math.PI * 2);
    g.fill();
    const y = ballAt(source);
    // Squash on the bounce.
    const squash = 1 - 0.25 * Math.max(0, 1 - (ground - ballR - y) / (h * 0.04));
    g.fillStyle = ACCENT;
    g.beginPath();
    g.ellipse(bx, y + ballR * (1 - squash), ballR * (2 - squash), ballR * squash, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.35)";
    g.beginPath();
    g.arc(bx - ballR * 0.35, y - ballR * 0.35, ballR * 0.28, 0, Math.PI * 2);
    g.fill();
  }

  /** The speed right now, big, with a direction mark. */
  #readout(g: CanvasRenderingContext2D, w: number, h: number, speed: number): void {
    const still = Math.abs(speed) < 0.02;
    const text = still ? "Freeze" : `${speed < 0 ? "◀ " : ""}${Math.abs(speed).toFixed(Math.abs(speed) < 1 ? 2 : 1)}×`;
    g.font = `800 ${String(Math.round(h * 0.11))}px Inter, "Segoe UI", sans-serif`;
    g.textBaseline = "top";
    g.fillStyle = "rgba(0, 0, 0, 0.35)";
    g.fillText(text, w * 0.035 + 2, h * 0.05 + 2);
    g.fillStyle = Math.abs(speed - 1) < 0.03 ? "rgba(255, 255, 255, 0.85)" : "#ffffff";
    g.fillText(text, w * 0.035, h * 0.05);
  }

  /** The speed graph over the whole loop: 1× before and after, the ramp's curve between. */
  #graph(g: CanvasRenderingContext2D, preset: SpeedPreset, w: number, h: number, t: number, ramp: number, s: number): void {
    const top = h * 0.74;
    const bottom = h * 0.97;
    const left = w * 0.03;
    const right = w * 0.97;
    const total = ramp + 2 * LEAD;
    const reverse = preset.points.some(([, v]) => v < 0);
    // With reverse, zero sits higher to leave room below it.
    const zero = reverse ? top + (bottom - top) * 0.55 : bottom;
    const lift = zero - top;
    const yOf = (v: number): number => zero - Math.max(-0.9, Math.min(1, level(v))) * lift;
    const xOf = (time: number): number => left + ((right - left) * time) / total;

    g.fillStyle = "rgba(14, 16, 22, 0.78)";
    g.fillRect(0, top - h * 0.03, w, h - top + h * 0.03);
    g.fillStyle = "rgba(255, 143, 63, 0.1)";
    g.fillRect(xOf(LEAD), top - h * 0.015, xOf(LEAD + ramp) - xOf(LEAD), bottom - top + h * 0.015);
    g.strokeStyle = "rgba(255, 255, 255, 0.28)";
    g.lineWidth = Math.max(1, w / 400);
    g.setLineDash([w / 120, w / 120]);
    g.beginPath();
    g.moveTo(left, yOf(1));
    g.lineTo(right, yOf(1));
    g.stroke();
    g.setLineDash([]);
    if (reverse) {
      g.strokeStyle = "rgba(255, 255, 255, 0.14)";
      g.beginPath();
      g.moveTo(left, zero);
      g.lineTo(right, zero);
      g.stroke();
    }
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    g.font = `600 ${String(Math.round(h * 0.045))}px Inter, "Segoe UI", sans-serif`;
    g.textBaseline = "bottom";
    g.fillText("1×", left, yOf(1) - 2);

    const steps = 120;
    g.strokeStyle = ACCENT;
    g.lineWidth = Math.max(1.5, w / 180);
    g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const time = (total * i) / steps;
      const v = this.#at(preset, time, ramp, s).speed;
      if (i === 0) g.moveTo(xOf(time), yOf(v));
      else g.lineTo(xOf(time), yOf(v));
    }
    g.stroke();

    const x = xOf(t);
    const v = this.#at(preset, t, ramp, s).speed;
    g.strokeStyle = "rgba(255, 255, 255, 0.7)";
    g.lineWidth = Math.max(1, w / 400);
    g.beginPath();
    g.moveTo(x, top - h * 0.015);
    g.lineTo(x, bottom);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(x, yOf(v), Math.max(2.5, w / 110), 0, Math.PI * 2);
    g.fill();
  }
}
