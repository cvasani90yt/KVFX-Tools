/**
 * After Effects version comparison.
 *
 * Commands declare `metadata.aeMin`; the registry filters out commands the
 * running host cannot support rather than letting them fail at execution time
 * (ARCHITECTURE §14). `app.version` reports strings such as "26.0.1x45", so the
 * parser tolerates a build suffix and missing components.
 */

export interface AeVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/**
 * Parses a version string, ignoring any trailing build information.
 * Returns `undefined` when the input does not begin with a numeric component.
 */
export function parseAeVersion(raw: string): AeVersion | undefined {
  const match = VERSION_PATTERN.exec(raw.trim());
  if (match === null) return undefined;

  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  const patch = match[3] === undefined ? 0 : Number(match[3]);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return undefined;
  }
  return { major, minor, patch };
}

/** Returns a negative number when `a < b`, zero when equal, positive when `a > b`. */
export function compareAeVersions(a: AeVersion, b: AeVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * True when `actual` is at least `required`.
 * Unparseable input is treated as "not satisfied" — fail closed, never assume
 * an API exists on a host we could not identify.
 */
export function satisfiesMinimum(actual: string, required: string): boolean {
  const a = parseAeVersion(actual);
  const r = parseAeVersion(required);
  if (a === undefined || r === undefined) return false;
  return compareAeVersions(a, r) >= 0;
}

export function formatAeVersion(v: AeVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}
