/**
 * The number counter: a text layer whose Source Text is driven by a slider.
 *
 * The slider holds progress (0–100) rather than the number itself. Slider
 * Control is capped at ±1,000,000, and counters routinely need more; keeping
 * the range in the expression means any magnitude works, and the user retimes
 * the count by moving two ordinary keyframes.
 */

export interface CounterOptions {
  readonly from: number;
  readonly to: number;
  readonly decimals: number;
  /** Thousands separator; empty for none. */
  readonly separator: string;
  /** Decimal mark, "." or ",". */
  readonly decimalMark: string;
  readonly prefix: string;
  readonly suffix: string;
  /** Seconds the count takes from the playhead. */
  readonly duration: number;
}

export const DEFAULT_COUNTER: CounterOptions = {
  from: 0,
  to: 1000,
  decimals: 0,
  separator: ",",
  decimalMark: ".",
  prefix: "",
  suffix: "",
  duration: 2,
};

export const COUNTER_EFFECT_NAME = "KVFX Counter";
const MAX_DECIMALS = 6;
/** One frame at 25 fps: the shortest count that still animates. */
const MIN_DURATION = 0.04;
const GROUP = 3;

/** A JavaScript string literal, safe inside an expression. */
export function quote(text: string): string {
  let out = '"';
  for (const ch of text) {
    if (ch === "\\" || ch === '"') out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else out += ch;
  }
  return `${out}"`;
}

export function normalizeCounter(options: Partial<CounterOptions>): CounterOptions {
  const merged = { ...DEFAULT_COUNTER, ...options };
  const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);
  return {
    from: finite(merged.from, DEFAULT_COUNTER.from),
    to: finite(merged.to, DEFAULT_COUNTER.to),
    decimals: Math.min(MAX_DECIMALS, Math.max(0, Math.round(finite(merged.decimals, 0)))),
    separator: merged.separator.slice(0, 1),
    decimalMark: merged.decimalMark === "," ? "," : ".",
    prefix: merged.prefix,
    suffix: merged.suffix,
    duration: Math.max(MIN_DURATION, finite(merged.duration, DEFAULT_COUNTER.duration)),
  };
}

export function counterExpression(input: Partial<CounterOptions>): string {
  const o = normalizeCounter(input);
  return [
    "// KVFX Tools — counter",
    `var from = ${String(o.from)};`,
    `var to = ${String(o.to)};`,
    `var decimals = ${String(o.decimals)};`,
    `var separator = ${quote(o.separator)};`,
    `var decimalMark = ${quote(o.decimalMark)};`,
    `var prefix = ${quote(o.prefix)};`,
    `var suffix = ${quote(o.suffix)};`,
    // By index, not by the parameter's display name, which is localised.
    `var progress = effect(${quote(COUNTER_EFFECT_NAME)})(1) / 100;`,
    "var n = from + (to - from) * progress;",
    "var digits = Math.abs(n).toFixed(decimals).split(\".\");",
    "var whole = digits[0];",
    "var grouped = \"\";",
    "while (whole.length > 3) {",
    "  grouped = separator + whole.substr(whole.length - 3) + grouped;",
    "  whole = whole.substr(0, whole.length - 3);",
    "}",
    "grouped = whole + grouped;",
    "if (digits.length > 1) grouped += decimalMark + digits[1];",
    "(n < 0 && Number(Math.abs(n).toFixed(decimals)) !== 0 ? \"-\" : \"\") + prefix + grouped + suffix;",
  ].join("\n");
}

/** What the counter shows at a given progress — the panel's live preview. */
export function formatCounter(input: Partial<CounterOptions>, progress: number): string {
  const o = normalizeCounter(input);
  const n = o.from + (o.to - o.from) * progress;
  const digits = Math.abs(n).toFixed(o.decimals).split(".");
  let whole = digits[0] ?? "0";
  let grouped = "";
  while (whole.length > GROUP) {
    grouped = o.separator + whole.slice(-GROUP) + grouped;
    whole = whole.slice(0, -GROUP);
  }
  grouped = whole + grouped;
  if (digits.length > 1) grouped += o.decimalMark + (digits[1] ?? "");
  const negative = n < 0 && Number(Math.abs(n).toFixed(o.decimals)) !== 0;
  return (negative ? "-" : "") + o.prefix + grouped + o.suffix;
}
