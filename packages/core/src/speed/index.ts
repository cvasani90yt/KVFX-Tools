/**
 * Speed ramps: presets as speed curves, the Time Remap expression that plays
 * them, and the maths the panel's preview shares with that expression.
 *
 * A preset is a list of [progress, speed] points across the ramp's window.
 * Between two points the speed eases (smoothstep), the way keyframes with
 * flat handles ease in the speed graph. The source time a ramp has played —
 * the integral of its speed — then has an exact closed form, so the
 * expression and the preview compute the same number without stepping.
 *
 * Each ramp on a layer is a layer marker whose comment names the preset and
 * strength and whose duration is the window. One expression on Time Remap
 * reads every such marker, so a clip can carry any number of ramps, and
 * dragging a marker moves its ramp, and stretching it retimes it.
 */

/* eslint-disable no-magic-numbers -- the presets' speed curves are the content */

export type SpeedGroup = "trend" | "slow" | "fast";

export const SPEED_GROUPS: readonly { readonly id: SpeedGroup; readonly label: string }[] = [
  { id: "trend", label: "Trending" },
  { id: "slow", label: "Slow motion" },
  { id: "fast", label: "Speed up" },
];

/** [progress through the window 0–1, speed multiplier] — negative plays backwards. */
export type SpeedPoint = readonly [number, number];

export interface SpeedPreset {
  readonly id: string;
  readonly name: string;
  readonly group: SpeedGroup;
  /** Window length in frames, before the user changes it. */
  readonly frames: number;
  /** Where in the window the key moment falls; it lands on the playhead. */
  readonly hit: number;
  /** One line for the panel. */
  readonly about: string;
  readonly points: readonly SpeedPoint[];
}

export const SPEED_RAMPS: readonly SpeedPreset[] = [
  // --- Trending ----------------------------------------------------------------
  {
    id: "velocity",
    name: "Velocity",
    group: "trend",
    frames: 36,
    hit: 0.5,
    about: "Rushes in, hangs slow on the beat and rushes out: the velocity edit.",
    points: [[0, 1], [0.14, 3], [0.4, 3], [0.5, 0.3], [0.72, 0.3], [0.86, 2.5], [1, 1]],
  },
  {
    id: "flashHit",
    name: "Flash Hit",
    group: "trend",
    frames: 30,
    hit: 0.46,
    about: "A burst of speed that slams into slow motion on the hit.",
    points: [[0, 1], [0.3, 5], [0.46, 0.15], [0.7, 0.15], [1, 1]],
  },
  {
    id: "beatHits",
    name: "Beat Hits",
    group: "trend",
    frames: 48,
    hit: 0.25,
    about: "Fast, slow, fast, slow: two slow beats for a double hit.",
    points: [[0, 1], [0.12, 2.6], [0.25, 0.35], [0.42, 2.6], [0.58, 0.35], [0.78, 2.6], [1, 1]],
  },
  {
    id: "boomerang",
    name: "Boomerang",
    group: "trend",
    frames: 40,
    hit: 0.42,
    about: "Plays forward, snaps back and plays forward again.",
    points: [[0, 1], [0.1, 2], [0.32, 2], [0.42, -2], [0.62, -2], [0.72, 2], [0.9, 2], [1, 1]],
  },

  // --- Slow motion -------------------------------------------------------------
  {
    id: "slowMo",
    name: "Slow-Mo",
    group: "slow",
    frames: 40,
    hit: 0.5,
    about: "Eases down to a third of the speed and back up.",
    points: [[0, 1], [0.3, 0.3], [0.7, 0.3], [1, 1]],
  },
  {
    id: "bulletTime",
    name: "Bullet Time",
    group: "slow",
    frames: 48,
    hit: 0.5,
    about: "Drops to near stillness for a long, floating moment.",
    points: [[0, 1], [0.15, 0.08], [0.85, 0.08], [1, 1]],
  },
  {
    id: "freezeHit",
    name: "Freeze Hit",
    group: "slow",
    frames: 30,
    hit: 0.1,
    about: "Stops dead on the moment, holds, then picks back up.",
    points: [[0, 1], [0.1, 0], [0.8, 0], [1, 1]],
  },
  {
    id: "impact",
    name: "Impact",
    group: "slow",
    frames: 36,
    hit: 0.4,
    about: "Speeds into the hit, then sinks into slow motion.",
    points: [[0, 1], [0.25, 2.4], [0.4, 0.12], [0.75, 0.25], [1, 1]],
  },

  // --- Speed up ----------------------------------------------------------------
  {
    id: "speedUp",
    name: "Speed Up",
    group: "fast",
    frames: 30,
    hit: 0.5,
    about: "A quick time-lapse burst through the middle.",
    points: [[0, 1], [0.25, 4], [0.75, 4], [1, 1]],
  },
  {
    id: "rampUp",
    name: "Ramp Up",
    group: "fast",
    frames: 48,
    hit: 0.88,
    about: "Starts slow and builds to a rush, for the run-up to a drop.",
    points: [[0, 1], [0.2, 0.5], [0.88, 5], [1, 1]],
  },
  {
    id: "slamStop",
    name: "Slam Stop",
    group: "fast",
    frames: 36,
    hit: 0.75,
    about: "Races in and brakes hard to a crawl.",
    points: [[0, 1], [0.15, 4], [0.55, 4], [0.75, 0.1], [1, 1]],
  },
  {
    id: "rewind",
    name: "Rewind",
    group: "fast",
    frames: 30,
    hit: 0.5,
    about: "Whirs backwards at speed, like rewinding a tape.",
    points: [[0, 1], [0.12, -4], [0.88, -4], [1, 1]],
  },
];

export function speedRampById(id: unknown): SpeedPreset | undefined {
  return SPEED_RAMPS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// The maths, shared by the expression, the command and the preview
// ---------------------------------------------------------------------------

/**
 * Strength as a power on the speed: 0 is no ramp (except that reverse stays
 * reverse), 1 the preset, 2 twice as extreme — a third becomes a ninth, four
 * times becomes sixteen.
 */
export function strengthen(speed: number, s: number): number {
  return speed < 0 ? -Math.pow(-speed, s) : Math.pow(speed, s);
}

/** The integral of smoothstep from 0 to r. */
const easeArea = (r: number): number => r * r * r - (r * r * r * r) / 2;
const smooth = (r: number): number => r * r * (3 - 2 * r);

/** Speed at progress `u` (0–1) through the window. */
export function speedAt(points: readonly SpeedPoint[], u: number, s = 1): number {
  if (points.length === 0) return 1;
  const first = points[0]!;
  if (u <= first[0]) return strengthen(first[1], s);
  for (let i = 1; i < points.length; i += 1) {
    const [u0, v0] = points[i - 1]!;
    const [u1, v1] = points[i]!;
    if (u <= u1) {
      const r = u1 > u0 ? (u - u0) / (u1 - u0) : 1;
      const a = strengthen(v0, s);
      return a + (strengthen(v1, s) - a) * smooth(r);
    }
  }
  return strengthen(points[points.length - 1]![1], s);
}

/** Source played by progress `u`, in windows: 1 means one window's length of footage. */
export function rampAdvance(points: readonly SpeedPoint[], u: number, s = 1): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [u0, v0] = points[i - 1]!;
    const [u1, v1] = points[i]!;
    if (u <= u0) break;
    const w = u1 - u0;
    if (w <= 0) continue;
    const r = Math.min(1, (u - u0) / w);
    const a = strengthen(v0, s);
    total += w * (a * r + (strengthen(v1, s) - a) * easeArea(r));
  }
  return total;
}

/** One ramp on a layer, in comp seconds. */
export interface PlacedRamp {
  readonly start: number;
  readonly duration: number;
  readonly preset: SpeedPreset;
  /** Strength as a fraction: 1 = 100%. */
  readonly s: number;
}

/**
 * The time Time Remap's own keyframes are read at, at comp time `t`: the
 * ramps' warp added up. This is what the expression computes.
 */
export function rampedTime(ramps: readonly PlacedRamp[], t: number): number {
  let w = t;
  for (const r of ramps) {
    if (!(r.duration > 0) || t <= r.start) continue;
    const u = Math.min(1, (t - r.start) / r.duration);
    w += r.duration * (rampAdvance(r.preset.points, u, r.s) - u);
  }
  return w;
}

/**
 * How much later (positive) or sooner the clip reaches its last frame with
 * this ramp — slow motion makes it longer, speed makes it shorter.
 */
export function rampLengthChange(preset: SpeedPreset, duration: number, s: number): number {
  return duration * (1 - rampAdvance(preset.points, 1, s));
}

/** The window for a ramp whose key moment lands on the playhead, on whole frames. */
export function speedRampWindow(options: { readonly time: number; readonly frame: number; readonly frames: number; readonly hit: number }): {
  readonly start: number;
  readonly duration: number;
} {
  const frame = options.frame > 0 ? options.frame : 1 / 30;
  const frames = Math.max(2, Math.round(options.frames));
  const start = Math.round((options.time - options.hit * frames * frame) / frame) * frame;
  return { start: Math.max(0, start), duration: frames * frame };
}

// ---------------------------------------------------------------------------
// The marker and the expression
// ---------------------------------------------------------------------------

export const SPEED_RAMP_TAG = "// KVFX Tools — speed ramp";
const COMMENT_HEAD = "KVFX Speed Ramp: ";

/** "KVFX Speed Ramp: Velocity (100%)" — editing the percentage changes the strength. */
export function speedRampComment(preset: SpeedPreset, strengthPercent: number): string {
  return `${COMMENT_HEAD}${preset.name} (${String(Math.round(strengthPercent))}%)`;
}

/** The preset and strength a marker comment names, or undefined. */
export function parseSpeedRampComment(comment: string): { readonly preset: SpeedPreset; readonly s: number } | undefined {
  const match = /KVFX Speed Ramp: (.+?) \((-?\d+(?:\.\d+)?)%\)/.exec(comment);
  if (match === null) return undefined;
  const preset = SPEED_RAMPS.find((p) => p.name === match[1]);
  return preset === undefined ? undefined : { preset, s: Number(match[2]) / 100 };
}

/**
 * The Time Remap expression. It is the same text for every ramp: the ramps
 * themselves are the layer's markers, read each frame. Written for both of
 * After Effects' expression engines (no `let`, arrows or template strings).
 */
export function speedRampExpression(): string {
  const table = SPEED_RAMPS.map((p) => `  ${JSON.stringify(p.name)}: ${JSON.stringify(p.points)}`).join(",\n");
  return [
    SPEED_RAMP_TAG,
    "// Each \"KVFX Speed Ramp\" layer marker is one ramp: drag it to move the ramp,",
    "// stretch it to retime it, or change the percentage in its comment.",
    "var P = {",
    table,
    "};",
    "function sp(v, s) { return v < 0 ? -Math.pow(-v, s) : Math.pow(v, s); }",
    "function area(r) { return r * r * r - r * r * r * r / 2; }",
    "function advance(p, u, s) {",
    "  var total = 0;",
    "  for (var i = 1; i < p.length; i++) {",
    "    var u0 = p[i - 1][0], u1 = p[i][0], w = u1 - u0;",
    "    if (u <= u0) break;",
    "    if (w <= 0) continue;",
    "    var r = Math.min(1, (u - u0) / w), a = sp(p[i - 1][1], s);",
    "    total += w * (a * r + (sp(p[i][1], s) - a) * area(r));",
    "  }",
    "  return total;",
    "}",
    "var m = thisLayer.marker, w = time;",
    "for (var k = 1; k <= m.numKeys; k++) {",
    "  var key = m.key(k), d = key.duration;",
    "  var hit = /KVFX Speed Ramp: (.+?) \\((-?\\d+(?:\\.\\d+)?)%\\)/.exec(key.comment);",
    "  if (!hit || !P[hit[1]] || !(d > 0) || time <= key.time) continue;",
    "  var u = Math.min(1, (time - key.time) / d);",
    "  w += d * (advance(P[hit[1]], u, parseFloat(hit[2]) / 100) - u);",
    "}",
    "valueAtTime(w);",
  ].join("\n");
}

/** The preview's view of a ramp at progress `u`. */
export interface SpeedPose {
  readonly speed: number;
  /** Source played so far, in windows. */
  readonly advance: number;
}

export function speedPose(preset: SpeedPreset, u: number, s = 1): SpeedPose {
  const at = Math.max(0, Math.min(1, u));
  return { speed: speedAt(preset.points, at, s), advance: rampAdvance(preset.points, at, s) };
}
