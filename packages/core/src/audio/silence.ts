/**
 * Finding the pauses in a voice track.
 *
 * The input is After Effects' own loudness reading — one value per frame, as
 * Convert Audio to Keyframes reports it. The threshold is relative to the
 * track's loud parts (its 95th percentile) rather than an absolute level, so
 * the same setting works on a quiet phone recording and a hot studio one.
 */

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export interface SilenceOptions {
  /** Below this share of the loud level counts as silence, 0–100 %. */
  readonly threshold: number;
  /** Pauses shorter than this, in seconds, are left alone. */
  readonly minSilence: number;
  /** Seconds of each pause kept next to the speech, so words are not clipped. */
  readonly padding: number;
}

export interface SilencePreset extends SilenceOptions {
  readonly id: string;
  readonly name: string;
}

export const SILENCE_PRESETS: readonly SilencePreset[] = [
  { id: "gentle", name: "Gentle", threshold: 5, minSilence: 0.7, padding: 0.18 },
  { id: "balanced", name: "Balanced", threshold: 9, minSilence: 0.45, padding: 0.12 },
  { id: "tight", name: "Tight", threshold: 14, minSilence: 0.25, padding: 0.06 },
];

const REFERENCE_PERCENTILE = 0.95;
const PERCENT = 100;

export interface SilenceResult {
  readonly silences: readonly TimeRange[];
  readonly keep: readonly TimeRange[];
  /** Seconds the silences add up to. */
  readonly removed: number;
  /** The loudness the threshold is a share of. */
  readonly reference: number;
}

function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

const ROUNDING = 1e4;

function round(t: number): number {
  return Math.round(t * ROUNDING) / ROUNDING;
}

export function findSilences(
  samples: readonly number[],
  start: number,
  frameDuration: number,
  options: SilenceOptions,
): SilenceResult {
  const end = start + samples.length * frameDuration;
  const reference = percentile(samples, REFERENCE_PERCENTILE);
  const level = (reference * Math.max(0, options.threshold)) / PERCENT;
  const silences: TimeRange[] = [];

  let run = -1;
  const close = (stop: number): void => {
    if (run < 0) return;
    const first = run;
    run = -1;
    const from = start + first * frameDuration;
    const to = start + stop * frameDuration;
    if (to - from < options.minSilence) return;
    // A pause at the very start or end has no speech on its outer side to pad.
    const a = first === 0 ? from : from + options.padding;
    const b = stop >= samples.length ? to : to - options.padding;
    if (b > a) silences.push({ start: round(a), end: round(b) });
  };
  samples.forEach((value, i) => {
    if (value <= level) {
      if (run < 0) run = i;
    } else close(i);
  });
  close(samples.length);

  const keep: TimeRange[] = [];
  let cursor = start;
  for (const silence of silences) {
    if (silence.start > cursor) keep.push({ start: round(cursor), end: silence.start });
    cursor = silence.end;
  }
  if (end > cursor) keep.push({ start: round(cursor), end: round(end) });

  const removed = silences.reduce((sum, s) => sum + (s.end - s.start), 0);
  return { silences, keep, removed: round(removed), reference };
}
