/**
 * The host's window onto After Effects.
 *
 * Every After Effects global the runtime touches goes through this interface so
 * that the dispatcher, the undo wrapper and each operation can be exercised
 * against the mock environment in `tests/mock-ae.ts` without launching
 * After Effects (DEVELOPMENT.md, tier 2).
 */
export interface AeEnvironment {
  /** `app.version`, e.g. "26.0.1x45". */
  version(): string;
  /** `app.buildName`. */
  buildName(): string;
  /** `app.isoLanguage`. */
  language(): string;
  /** `$.os`. */
  os(): string;
  /** `$.version` — the ExtendScript engine version. */
  engineVersion(): string;
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
  /** Milliseconds since the epoch. Injectable so budget tests are deterministic. */
  nowMs(): number;
}
