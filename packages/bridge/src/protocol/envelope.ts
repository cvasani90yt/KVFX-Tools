import type { ErrorCode, KvfxError } from "@kvfx/core";
import type { JsonObject, JsonValue } from "./json.js";

/**
 * Wire protocol version.
 *
 * Bumped on any breaking change to the envelope shape. Both sides check it: a
 * host bundle older than the panel refuses the call with a clear upgrade error
 * instead of misinterpreting fields (ARCHITECTURE §8). This matters because the
 * host bundle and the panel are separate build artefacts that a user can end up
 * mixing after a partial update.
 */
export const PROTOCOL_VERSION = 1;

/** Default wall-clock budget for a single host invocation, in milliseconds. */
export const DEFAULT_BUDGET_MS = 250;

/**
 * Hard ceiling for any host invocation. After Effects is frozen for the whole
 * duration of a host call (F10), so this is a responsiveness guarantee, not a
 * convenience.
 */
export const MAX_BUDGET_MS = 1000;

/** How much of an unparseable host reply we quote back in the error. */
const ERROR_EXCERPT_CHARS = 200;

/**
 * The operation id a `kind: "plan"` request must carry.
 *
 * Part of the wire contract, so it lives here rather than in the host: the
 * panel has to name it when sending, and the host has to recognise it when
 * receiving.
 */
export const PLAN_OPERATION_ID = "kvfx.op.core.plan";

export type RequestKind =
  /** A single primitive operation. */
  | "op"
  /** An ordered list of operations executed under one undo group (ADR-0006). */
  | "plan"
  /** A read-only query. Never opens an undo group. */
  | "query";

export interface HostRequest {
  readonly v: number;
  readonly id: string;
  readonly kind: RequestKind;
  /** Operation id, e.g. "kvfx.op.system.ping". */
  readonly op: string;
  readonly args: JsonObject;
  readonly budgetMs: number;
  /**
   * Undo group label. Required for "plan" and mutating "op" requests, and
   * forbidden for "query" — a read must never open an undo group.
   */
  readonly undoGroup?: string;
}

export interface HostResponseOk {
  readonly v: number;
  readonly id: string;
  readonly ok: true;
  readonly result: JsonValue;
  /** Host-measured execution time, used to police the budgets in §13. */
  readonly elapsedMs: number;
}

export interface HostResponseErr {
  readonly v: number;
  readonly id: string;
  readonly ok: false;
  readonly error: KvfxError;
  readonly elapsedMs: number;
}

export type HostResponse = HostResponseOk | HostResponseErr;

export interface BuildRequestInput {
  readonly id: string;
  readonly kind: RequestKind;
  readonly op: string;
  readonly args?: JsonObject;
  readonly budgetMs?: number;
  readonly undoGroup?: string;
}

/** Thrown for programming errors on our own side, before anything is sent. */
export class ProtocolError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

/**
 * Operation ids: `kvfx.op.<group>.<name>`, lowerCamelCase per segment.
 *
 * Enforced here because an id the host does not recognise produces a confusing
 * runtime failure, whereas a malformed one is caught before anything is sent.
 */
const OP_ID_PATTERN = /^kvfx\.op\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

export function buildRequest(input: BuildRequestInput): HostRequest {
  if (!OP_ID_PATTERN.test(input.op)) {
    throw new ProtocolError("invalid_request", `Malformed operation id: ${input.op}`);
  }

  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > MAX_BUDGET_MS) {
    throw new ProtocolError(
      "invalid_request",
      `Budget must be within (0, ${MAX_BUDGET_MS}] ms, received ${String(budgetMs)}`,
    );
  }

  if (input.kind === "query" && input.undoGroup !== undefined) {
    throw new ProtocolError("invalid_request", "A query must not open an undo group");
  }

  const base = {
    v: PROTOCOL_VERSION,
    id: input.id,
    kind: input.kind,
    op: input.op,
    args: input.args ?? {},
    budgetMs,
  };

  return input.undoGroup === undefined ? base : { ...base, undoGroup: input.undoGroup };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a decoded host response.
 *
 * The host is our own code, but the response arrives as a string that has been
 * through `evalScript`. A truncated or non-JSON reply is a real failure mode
 * (an uncaught ExtendScript error yields the literal string "EvalScript error"),
 * so the shape is checked rather than asserted.
 */
export function parseResponse(raw: string): HostResponse {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new ProtocolError(
      "transport_failure",
      `Host returned a non-JSON reply: ${raw.slice(0, ERROR_EXCERPT_CHARS)}`,
    );
  }

  if (!isRecord(decoded)) {
    throw new ProtocolError("transport_failure", "Host reply was not an object");
  }
  if (decoded["v"] !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "protocol_mismatch",
      `Host speaks protocol ${String(decoded["v"])}, panel speaks ${String(PROTOCOL_VERSION)}. ` +
        "Reinstall KVFX Tools so both halves match.",
    );
  }
  if (typeof decoded["id"] !== "string" || typeof decoded["ok"] !== "boolean") {
    throw new ProtocolError("transport_failure", "Host reply was missing required fields");
  }

  const elapsedMs = typeof decoded["elapsedMs"] === "number" ? decoded["elapsedMs"] : 0;

  if (decoded["ok"] === true) {
    return {
      v: PROTOCOL_VERSION,
      id: decoded["id"],
      ok: true,
      result: (decoded["result"] ?? null) as JsonValue,
      elapsedMs,
    };
  }

  const error = decoded["error"];
  if (!isRecord(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") {
    throw new ProtocolError("transport_failure", "Host error reply was malformed");
  }

  return {
    v: PROTOCOL_VERSION,
    id: decoded["id"],
    ok: false,
    error: error as unknown as KvfxError,
    elapsedMs,
  };
}
