/**
 * Explicit success/failure values.
 *
 * Operations that can fail return a `Result` rather than throwing, so that the
 * bridge can serialise failure across the host boundary and so that a failed
 * operation inside a plan aborts the plan deterministically (ARCHITECTURE §7)
 * rather than unwinding through an exception path that might skip
 * `endUndoGroup()`.
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

/** Applies `fn` to a success value, passing failures through untouched. */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Returns the success value, or `fallback` when the result is a failure. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
