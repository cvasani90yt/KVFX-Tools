/**
 * Version comparison, duplicated from `@kvfx/core` for the reasons given in
 * `runtime/protocol.ts`. `tests/contract.test.ts` pins the two implementations
 * to identical behaviour across a shared table of cases.
 */

/** major, minor, patch. */
const VERSION_COMPONENTS = 3;

export function satisfiesMinimum(actual: string, required: string): boolean {
  const a = parse(actual);
  const r = parse(required);
  // Fail closed: never assume an API exists on a host we could not identify.
  if (!a || !r) return false;

  for (let i = 0; i < VERSION_COMPONENTS; i += 1) {
    const av = a[i] as number;
    const rv = r[i] as number;
    if (av !== rv) return av > rv;
  }
  return true;
}

function parse(raw: string): number[] | undefined {
  const match = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw);
  if (!match) return undefined;
  return [Number(match[1]), match[2] ? Number(match[2]) : 0, match[3] ? Number(match[3]) : 0];
}
