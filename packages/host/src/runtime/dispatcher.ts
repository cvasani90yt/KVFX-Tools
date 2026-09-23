import type { AeEnvironment } from "../ae/environment.js";
import { withUndoGroup } from "../ae/undo.js";
import { isArray } from "./es3.js";
import { ErrorCode, MIN_AE_VERSION, PROTOCOL_VERSION } from "./protocol.js";
import type { OperationRegistry } from "./registry.js";
import { type HostJson, stringify } from "./serialize.js";
import { satisfiesMinimum } from "./version.js";

/**
 * The single entry point After Effects calls.
 *
 * Contract: `dispatch` **never throws and always returns a JSON string**. An
 * exception escaping into `evalScript` makes CEP return the bare string
 * "EvalScript error.", which loses the cause entirely — the user gets a dead
 * panel and we get an unactionable bug report. Everything is caught here and
 * turned into a structured reply instead (ARCHITECTURE §11).
 */

interface RawRequest {
  v?: unknown;
  id?: unknown;
  kind?: unknown;
  op?: unknown;
  args?: unknown;
  budgetMs?: unknown;
  undoGroup?: unknown;
}

export function createDispatcher(
  registry: OperationRegistry,
  env: AeEnvironment,
): (request: unknown) => string {
  return function dispatch(request: unknown): string {
    const startedMs = env.nowMs();
    let id = "unknown";

    try {
      const raw = (request || {}) as RawRequest;
      if (typeof raw.id === "string") id = raw.id;

      if (raw.v !== PROTOCOL_VERSION) {
        return fail(
          id,
          ErrorCode.ProtocolMismatch,
          `Panel speaks protocol ${String(raw.v)}, host speaks ${String(PROTOCOL_VERSION)}. ` +
            "Reinstall KVFX Tools so both halves match.",
          env.nowMs() - startedMs,
        );
      }

      const opId = raw.op;
      const kind = raw.kind;
      if (typeof opId !== "string" || typeof id !== "string" || typeof kind !== "string") {
        return fail(id, ErrorCode.InvalidRequest, "Request was missing required fields", env.nowMs() - startedMs);
      }
      if (kind !== "op" && kind !== "plan" && kind !== "query") {
        return fail(id, ErrorCode.InvalidRequest, `Unknown request kind: ${kind}`, env.nowMs() - startedMs);
      }

      const budgetMs = typeof raw.budgetMs === "number" ? raw.budgetMs : 0;
      if (!(budgetMs > 0)) {
        return fail(id, ErrorCode.InvalidRequest, "Request carried no usable budget", env.nowMs() - startedMs);
      }

      const args = raw.args;
      if (!args || typeof args !== "object" || isArray(args)) {
        return fail(id, ErrorCode.InvalidRequest, "Request args must be an object", env.nowMs() - startedMs);
      }

      const operation = registry.lookup(opId);
      if (!operation) {
        return fail(id, ErrorCode.UnknownOperation, `No operation registered as ${opId}`, env.nowMs() - startedMs);
      }

      const aeVersion = env.version();
      if (!satisfiesMinimum(aeVersion, MIN_AE_VERSION)) {
        return fail(
          id,
          ErrorCode.UnsupportedHostVersion,
          `KVFX Tools requires After Effects ${MIN_AE_VERSION} or newer; this host reports ${aeVersion}.`,
          env.nowMs() - startedMs,
        );
      }
      if (operation.aeMin && !satisfiesMinimum(aeVersion, operation.aeMin)) {
        return fail(
          id,
          ErrorCode.UnsupportedHostVersion,
          `${opId} requires After Effects ${operation.aeMin} or newer; this host reports ${aeVersion}.`,
          env.nowMs() - startedMs,
        );
      }

      const undoGroup = typeof raw.undoGroup === "string" ? raw.undoGroup : undefined;
      if (operation.mutates && !undoGroup) {
        // Structural, not advisory: a mutation without an undo group would be
        // unrecoverable for the user.
        return fail(
          id,
          ErrorCode.InvalidRequest,
          `${opId} modifies the project and requires an undo group`,
          env.nowMs() - startedMs,
        );
      }
      if (!operation.mutates && undoGroup) {
        return fail(
          id,
          ErrorCode.InvalidRequest,
          `${opId} is read-only and must not open an undo group`,
          env.nowMs() - startedMs,
        );
      }

      const ctx = {
        env,
        args: args as { [key: string]: HostJson },
        deadlineMs: startedMs + budgetMs,
      };

      const result: HostJson = undoGroup
        ? withUndoGroup(env, undoGroup, function () {
            return operation.run(ctx);
          })
        : operation.run(ctx);

      const elapsedMs = env.nowMs() - startedMs;
      if (elapsedMs > budgetMs) {
        // The work is already done and committed; we report the overrun rather
        // than pretending it did not happen, so the budget regressions in
        // ARCHITECTURE §13 are visible instead of silent.
        return fail(
          id,
          ErrorCode.BudgetExceeded,
          `${opId} took ${String(elapsedMs)} ms against a ${String(budgetMs)} ms budget`,
          elapsedMs,
        );
      }

      return stringify({ v: PROTOCOL_VERSION, id, ok: true, result, elapsedMs });
    } catch (cause) {
      return fail(id, ErrorCode.HostException, describe(cause), env.nowMs() - startedMs);
    }
  };
}

/**
 * Renders an unknown thrown value as a message.
 *
 * ExtendScript errors carry `message` and a `line` number, and that line number
 * is often the only clue available — there is no debugger and no stack trace, so
 * it is worth keeping.
 */
function describe(cause: unknown): string {
  if (cause && typeof cause === "object") {
    const e = cause as { message?: unknown; line?: unknown };
    const message = typeof e.message === "string" ? e.message : "Unrecognised host error";
    return typeof e.line === "number" ? `${message} (line ${String(e.line)})` : message;
  }
  if (typeof cause === "string") return cause;
  if (typeof cause === "number" || typeof cause === "boolean") return String(cause);
  return "Unrecognised host error";
}

function fail(id: string, code: string, message: string, elapsedMs: number): string {
  return stringify({
    v: PROTOCOL_VERSION,
    id,
    ok: false,
    error: { code, message },
    elapsedMs,
  });
}
