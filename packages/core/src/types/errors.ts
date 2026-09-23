/**
 * Structured error taxonomy.
 *
 * Raw exception text never reaches a user (ARCHITECTURE §11). Every failure is
 * assigned a stable code here; the UI maps the code to a friendly message and
 * attaches the technical detail to the "Show details" disclosure only.
 */

export const ErrorCode = {
  /** The request envelope failed validation before it was dispatched. */
  ProtocolMismatch: "protocol_mismatch",
  InvalidRequest: "invalid_request",

  /** No operation is registered under the requested id. */
  UnknownOperation: "unknown_operation",

  /** An argument was missing, of the wrong type, or out of range. */
  InvalidArgument: "invalid_argument",

  /** An object referenced by id no longer exists in the project (ADR-0004). */
  TargetNotFound: "target_not_found",

  /** Preconditions were not met — e.g. no composition open, nothing selected. */
  PreconditionFailed: "precondition_failed",

  /** The operation exceeded its wall-clock budget and was aborted. */
  BudgetExceeded: "budget_exceeded",

  /** The running After Effects version is below the operation's minimum. */
  UnsupportedHostVersion: "unsupported_host_version",

  /** The host bundle raised an exception that was captured, not surfaced raw. */
  HostException: "host_exception",

  /** The bridge transport failed — panel/host channel unavailable. */
  TransportFailure: "transport_failure",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface KvfxError {
  readonly code: ErrorCode;
  /** Technical, developer-facing. Never rendered as the primary user message. */
  readonly message: string;
  /** Optional structured context — must not contain project content. */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
  /** Correlates the user-visible error with the log entry. */
  readonly diagnosticId?: string;
}

export function kvfxError(
  code: ErrorCode,
  message: string,
  detail?: Readonly<Record<string, string | number | boolean>>,
): KvfxError {
  return detail === undefined ? { code, message } : { code, message, detail };
}
