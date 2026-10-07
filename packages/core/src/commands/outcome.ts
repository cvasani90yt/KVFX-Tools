import { ErrorCode, type KvfxError } from "../types/errors.js";
import type { JsonValue } from "../types/json.js";

/**
 * What the user reads after a command.
 *
 * Host operations phrase their refusals for people ("Select keyframes in the
 * timeline first."), so those pass through. Anything that could carry a raw
 * script error — an exception, a protocol fault — is replaced by plain words;
 * the technical message stays in diagnostics.
 */
export function userMessage(error: KvfxError): string {
  switch (error.code) {
    case ErrorCode.PreconditionFailed:
    case ErrorCode.TargetNotFound:
    case ErrorCode.UnsupportedHostVersion:
    case ErrorCode.InvalidArgument:
      return error.message;
    case ErrorCode.BudgetExceeded:
      return "That took too long and was stopped. Try it on fewer layers.";
    case ErrorCode.TransportFailure:
      return "Lost contact with After Effects. Close and reopen the panel.";
    case ErrorCode.ProtocolMismatch:
    case ErrorCode.UnknownOperation:
      return "The panel and its After Effects script are different versions. Reinstall KVFX Tools.";
    case ErrorCode.HostException:
      return "After Effects couldn't complete that. Edit ▸ Undo reverts anything it started.";
    default:
      return "Something went wrong. Details are in Settings ▸ Diagnostics.";
  }
}

interface Skip {
  readonly reason: string;
}

interface Counts {
  changed: number;
  missing: number;
  failures: number;
  /** Comps a deep duplicate made, including nested ones. */
  comps: number;
  /** Expressions naming a comp at runtime, which a deep duplicate cannot retarget. */
  dynamic: number;
  created: string[];
}

function collect(value: JsonValue, skips: Skip[], counts: Counts): void {
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, skips, counts);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    if (key === "skipped" && Array.isArray(entry)) {
      for (const skip of entry) {
        if (typeof skip === "object" && skip !== null && !Array.isArray(skip) && typeof skip["reason"] === "string") {
          skips.push({ reason: skip["reason"] });
        }
      }
    } else if (key === "missingIds" && Array.isArray(entry)) {
      counts.missing += entry.length;
    } else if (key === "failures" && Array.isArray(entry)) {
      counts.failures += entry.length;
    } else if (key === "changedCount" && typeof entry === "number") {
      counts.changed += entry;
    } else if (key === "compCount" && typeof entry === "number") {
      counts.comps += entry;
    } else if (key === "dynamicExpressions" && typeof entry === "number") {
      counts.dynamic += entry;
    } else if (key === "createdNames" && Array.isArray(entry)) {
      for (const name of entry) if (typeof name === "string") counts.created.push(name);
    } else if (typeof entry === "object" && entry !== null) {
      collect(entry, skips, counts);
    }
  }
}

/**
 * One line describing a successful run, including what was left alone.
 *
 * "Done" alone would hide that three of five layers were locked and skipped;
 * the user would assume all five changed.
 */
export function summarizeResult(result: JsonValue): string {
  const skips: Skip[] = [];
  const counts: Counts = { changed: 0, missing: 0, failures: 0, comps: 0, dynamic: 0, created: [] };
  collect(result, skips, counts);

  const notes: string[] = [];
  if (counts.created.length > 0) {
    const shown = counts.created.slice(0, 2).join(", ");
    const more = counts.created.length > 2 ? ` and ${String(counts.created.length - 2)} more` : "";
    const nested = counts.comps - counts.created.length;
    notes.push(`created ${shown}${more}${nested > 0 ? ` (+${String(nested)} nested)` : ""}`);
  }
  if (counts.dynamic > 0) {
    const one = counts.dynamic === 1;
    notes.push(
      `${String(counts.dynamic)} expression${one ? " names" : "s name"} a comp at runtime and still point${one ? "s" : ""} at the original`,
    );
  }
  if (skips.length > 0) {
    const reasons = [...new Set(skips.map((s) => s.reason))];
    const shown = reasons.slice(0, 2).join("; ");
    const more = reasons.length > 2 ? "; …" : "";
    notes.push(`${String(skips.length)} skipped — ${shown}${more}`);
  }
  if (counts.failures > 0) notes.push(`${String(counts.failures)} couldn't change`);
  if (counts.missing > 0) notes.push(`${String(counts.missing)} no longer exist`);
  return notes.length === 0 ? "Done" : `Done · ${notes.join(" · ")}`;
}
