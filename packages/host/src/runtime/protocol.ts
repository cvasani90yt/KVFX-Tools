/**
 * The host's copy of the wire contract.
 *
 * `@kvfx/host` intentionally imports nothing. It compiles to ES5 for
 * ExtendScript while every other package targets ES2021, so sharing modules
 * across that boundary would drag modern output into a bundle that cannot run
 * it. The duplication is small, deliberate, and pinned by
 * `tests/contract.test.ts`, which fails if these values drift from
 * `@kvfx/core` and `@kvfx/bridge`.
 */

export const PROTOCOL_VERSION = 1;

export const ErrorCode = {
  ProtocolMismatch: "protocol_mismatch",
  InvalidRequest: "invalid_request",
  UnknownOperation: "unknown_operation",
  InvalidArgument: "invalid_argument",
  TargetNotFound: "target_not_found",
  PreconditionFailed: "precondition_failed",
  BudgetExceeded: "budget_exceeded",
  UnsupportedHostVersion: "unsupported_host_version",
  HostException: "host_exception",
  TransportFailure: "transport_failure",
};

export const MIN_AE_VERSION = "22.0";
