import { type HostTransport, TransportUnavailableError } from "@kvfx/bridge";
import { EVAL_SCRIPT_ERROR } from "./types.js";

/**
 * The only place in the product that calls a CEP API (ADR-0001).
 *
 * `evalScript` is callback-based, one-shot, and reports failure by resolving
 * with the literal string "EvalScript error." rather than by erroring — so the
 * adapter converts that into a real rejection. Without this, an exception inside
 * After Effects would surface to the user as an unparseable reply with no cause
 * attached.
 */
export function createCepTransport(): HostTransport {
  const cep = window.__adobe_cep__;
  if (cep === undefined) {
    throw new TransportUnavailableError(
      "KVFX Tools is not running inside After Effects. Open it from Window ▸ Extensions.",
    );
  }

  return {
    evaluate(source: string): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        try {
          cep.evalScript(source, (result: string) => {
            if (settled) return;
            settled = true;
            if (result === EVAL_SCRIPT_ERROR) {
              reject(
                new Error(
                  "After Effects could not evaluate the request. The KVFX host script may not be loaded.",
                ),
              );
              return;
            }
            resolve(result);
          });
        } catch (cause) {
          settled = true;
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    },
  };
}

export function isRunningInCep(): boolean {
  return typeof window !== "undefined" && window.__adobe_cep__ !== undefined;
}
