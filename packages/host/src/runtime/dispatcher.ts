import type { AeEnvironment } from "../ae/environment.js";
import { withUndoGroup } from "../ae/undo.js";
import { isArray } from "./es3.js";
import { type CodedHostError, hostError } from "./errors.js";
import { ErrorCode, MIN_AE_VERSION, PROTOCOL_VERSION } from "./protocol.js";
import type { Operation, OperationRegistry } from "./registry.js";
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

/**
 * The operation id a `kind: "plan"` request must carry.
 *
 * Duplicated from `@kvfx/bridge` for the reasons in `runtime/protocol.ts`, and
 * pinned to it by `tests/contract.test.ts`.
 */
export const PLAN_OPERATION_ID = "kvfx.op.core.plan";

interface RawRequest {
  v?: unknown;
  id?: unknown;
  kind?: unknown;
  op?: unknown;
  args?: unknown;
  budgetMs?: unknown;
  undoGroup?: unknown;
}

interface HostFailure {
  readonly code: string;
  readonly message: string;
  readonly detail?: { [key: string]: HostJson };
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

      const validation = validate(raw, registry, env);
      if (!validation.ok) {
        return fail(id, validation.failure, env.nowMs() - startedMs);
      }

      const { operation, kind, args, budgetMs, undoGroup } = validation;
      const deadlineMs = startedMs + budgetMs;

      const body = (): HostJson =>
        kind === "plan"
          ? runPlan(registry, env, args, deadlineMs)
          : operation.run({ env, args, deadlineMs });

      const result: HostJson = undoGroup === undefined ? body() : withUndoGroup(env, undoGroup, body);

      const elapsedMs = env.nowMs() - startedMs;
      if (elapsedMs > budgetMs) {
        // The work is already committed; we report the overrun rather than
        // pretending it did not happen, so budget regressions stay visible.
        return fail(
          id,
          {
            code: ErrorCode.BudgetExceeded,
            message: `${operation.id} took ${String(elapsedMs)} ms against a ${String(budgetMs)} ms budget`,
          },
          elapsedMs,
        );
      }

      return stringify({ v: PROTOCOL_VERSION, id, ok: true, result, elapsedMs });
    } catch (cause) {
      return fail(id, toFailure(cause), env.nowMs() - startedMs);
    }
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Validation =
  | { ok: false; failure: HostFailure }
  | {
      ok: true;
      operation: Operation;
      kind: string;
      args: { [key: string]: HostJson };
      budgetMs: number;
      undoGroup: string | undefined;
    };

function validate(raw: RawRequest, registry: OperationRegistry, env: AeEnvironment): Validation {
  const reject = (code: string, message: string): Validation => ({ ok: false, failure: { code, message } });

  if (raw.v !== PROTOCOL_VERSION) {
    return reject(
      ErrorCode.ProtocolMismatch,
      `Panel speaks protocol ${String(raw.v)}, host speaks ${String(PROTOCOL_VERSION)}. ` +
        "Reinstall KVFX Tools so both halves match.",
    );
  }

  const opId = raw.op;
  const kind = raw.kind;
  if (typeof opId !== "string" || typeof raw.id !== "string" || typeof kind !== "string") {
    return reject(ErrorCode.InvalidRequest, "Request was missing required fields");
  }
  if (kind !== "op" && kind !== "plan" && kind !== "query") {
    return reject(ErrorCode.InvalidRequest, `Unknown request kind: ${kind}`);
  }
  if (kind === "plan" && opId !== PLAN_OPERATION_ID) {
    return reject(ErrorCode.InvalidRequest, `A plan request must use ${PLAN_OPERATION_ID}`);
  }

  const budgetMs = typeof raw.budgetMs === "number" ? raw.budgetMs : 0;
  if (!(budgetMs > 0)) {
    return reject(ErrorCode.InvalidRequest, "Request carried no usable budget");
  }

  const args = raw.args;
  if (!args || typeof args !== "object" || isArray(args)) {
    return reject(ErrorCode.InvalidRequest, "Request args must be an object");
  }

  const aeVersion = env.version();
  if (!satisfiesMinimum(aeVersion, MIN_AE_VERSION)) {
    return reject(
      ErrorCode.UnsupportedHostVersion,
      `KVFX Tools requires After Effects ${MIN_AE_VERSION} or newer; this host reports ${aeVersion}.`,
    );
  }

  // A plan has no single operation of its own; its steps are checked as they run.
  const operation: Operation =
    kind === "plan"
      ? { id: PLAN_OPERATION_ID, mutates: true, run: (): HostJson => null }
      : (registry.lookup(opId) as Operation);

  if (kind !== "plan" && !operation) {
    return reject(ErrorCode.UnknownOperation, `No operation registered as ${opId}`);
  }
  if (operation.aeMin && !satisfiesMinimum(aeVersion, operation.aeMin)) {
    return reject(
      ErrorCode.UnsupportedHostVersion,
      `${opId} requires After Effects ${operation.aeMin} or newer; this host reports ${aeVersion}.`,
    );
  }

  const undoGroup = typeof raw.undoGroup === "string" ? raw.undoGroup : undefined;
  if (operation.mutates && undoGroup === undefined) {
    // Structural, not advisory: a mutation without an undo group would be
    // unrecoverable for the user.
    return reject(ErrorCode.InvalidRequest, `${opId} modifies the project and requires an undo group`);
  }
  if (!operation.mutates && undoGroup !== undefined) {
    return reject(ErrorCode.InvalidRequest, `${opId} is read-only and must not open an undo group`);
  }

  return {
    ok: true,
    operation,
    kind,
    args: args as { [key: string]: HostJson },
    budgetMs,
    undoGroup,
  };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * Runs the steps of a plan inside the caller's undo group.
 *
 * If a step fails, earlier steps have already been applied. That is deliberate
 * and safe: because the whole plan runs inside one undo group, a single undo
 * reverts everything that did happen. Attempting to hand-roll a rollback would
 * mean re-implementing After Effects' own undo, badly.
 */
function runPlan(
  registry: OperationRegistry,
  env: AeEnvironment,
  args: { [key: string]: HostJson },
  deadlineMs: number,
): HostJson {
  const steps = args["steps"];
  if (!steps || !isArray(steps)) {
    throw hostError(ErrorCode.InvalidRequest, "A plan requires a steps array");
  }

  const list = steps as HostJson[];
  if (list.length === 0) {
    throw hostError(ErrorCode.InvalidRequest, "A plan must contain at least one step");
  }

  const results: HostJson[] = [];

  for (let i = 0; i < list.length; i += 1) {
    if (env.nowMs() > deadlineMs) {
      throw hostError(
        ErrorCode.BudgetExceeded,
        `Plan exceeded its budget after ${String(i)} of ${String(list.length)} steps`,
      );
    }

    const step = list[i];
    if (!step || typeof step !== "object" || isArray(step)) {
      throw hostError(ErrorCode.InvalidRequest, `Step ${String(i)} is not an object`);
    }

    const bag = step as { [key: string]: HostJson };
    const stepOp = bag["op"];
    const stepArgs = bag["args"];

    if (typeof stepOp !== "string") {
      throw hostError(ErrorCode.InvalidRequest, `Step ${String(i)} has no operation id`);
    }
    if (!stepArgs || typeof stepArgs !== "object" || isArray(stepArgs)) {
      throw hostError(ErrorCode.InvalidRequest, `Step ${String(i)} args must be an object`);
    }

    const operation = registry.lookup(stepOp);
    if (!operation) {
      throw hostError(
        ErrorCode.UnknownOperation,
        `Step ${String(i)} refers to unknown operation ${stepOp}`,
      );
    }
    if (operation.aeMin && !satisfiesMinimum(env.version(), operation.aeMin)) {
      throw hostError(
        ErrorCode.UnsupportedHostVersion,
        `${stepOp} requires After Effects ${operation.aeMin} or newer`,
      );
    }

    results[results.length] = {
      op: stepOp,
      result: operation.run({ env, args: stepArgs as { [key: string]: HostJson }, deadlineMs }),
    };
  }

  return { stepCount: list.length, steps: results as unknown as HostJson };
}

// ---------------------------------------------------------------------------
// Failure reporting
// ---------------------------------------------------------------------------

function toFailure(cause: unknown): HostFailure {
  if (cause && typeof cause === "object") {
    const e = cause as Partial<CodedHostError> & { line?: unknown };
    const message = typeof e.message === "string" ? e.message : "Unrecognised host error";

    // Operations raise `{ kvfxCode, message }` for conditions they anticipated,
    // so those keep their specific code instead of collapsing into a generic
    // host exception the panel cannot explain to the user.
    if (typeof e.kvfxCode === "string") {
      return { code: e.kvfxCode, message };
    }
    return {
      code: ErrorCode.HostException,
      // The line number is often the only clue available: ExtendScript gives us
      // no stack trace and there is no debugger.
      message: typeof e.line === "number" ? `${message} (line ${String(e.line)})` : message,
    };
  }
  if (typeof cause === "string") return { code: ErrorCode.HostException, message: cause };
  return { code: ErrorCode.HostException, message: "Unrecognised host error" };
}

function fail(id: string, failure: HostFailure, elapsedMs: number): string {
  const error: { [key: string]: HostJson } = { code: failure.code, message: failure.message };
  if (failure.detail) error["detail"] = failure.detail;
  return stringify({ v: PROTOCOL_VERSION, id, ok: false, error, elapsedMs });
}
