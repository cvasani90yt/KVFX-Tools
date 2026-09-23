/**
 * Timer globals.
 *
 * `@kvfx/bridge` runs in the CEP panel and in Node under test, so it must not
 * pull in either the DOM or the Node type surface — declaring the two functions
 * it actually uses keeps the package honest about its environment assumptions.
 * Ambient `.d.ts` files are not emitted, so this never leaks to consumers.
 */

type KvfxTimerHandle = unknown;

declare function setTimeout(handler: () => void, timeoutMs: number): KvfxTimerHandle;
declare function clearTimeout(handle: KvfxTimerHandle): void;
