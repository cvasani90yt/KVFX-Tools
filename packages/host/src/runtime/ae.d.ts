/**
 * Minimal ambient declarations for the After Effects scripting globals this
 * package touches.
 *
 * Deliberately not exhaustive: we declare what we use, so that adding a new
 * After Effects API is a visible, reviewed change rather than something that
 * type-checks by accident. Everything here is read-only from our perspective
 * unless an operation explicitly mutates it.
 */

interface AeApplication {
  /** e.g. "26.0.1x45" */
  readonly version: string;
  /** e.g. "Adobe After Effects 26.0.1x45" */
  readonly buildName: string;
  /** ISO language of the running host, e.g. "en_US". */
  readonly isoLanguage: string;
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
}

interface AeDollar {
  /** Operating system description string. */
  readonly os: string;
  /** ExtendScript engine version. */
  readonly version: string;
  readonly global: Record<string, unknown>;
}

declare const app: AeApplication;
declare const $: AeDollar;
