import type { AeEnvironment } from "./environment.js";

/**
 * Runs `body` inside exactly one After Effects undo group.
 *
 * The `finally` is the entire point. If `body` throws — a bug of ours, or an
 * After Effects error we did not anticipate — and `endUndoGroup()` is skipped,
 * After Effects is left with an open undo group: subsequent unrelated user
 * actions get swallowed into it and the undo stack is corrupted for the rest of
 * the session. That is data loss, and it is not recoverable by the user.
 *
 * So: one group per user intent, opened and closed in the same synchronous
 * host call, never held across an await (ARCHITECTURE §7).
 */
export function withUndoGroup<T>(env: AeEnvironment, label: string, body: () => T): T {
  env.beginUndoGroup(label);
  try {
    return body();
  } finally {
    env.endUndoGroup();
  }
}
