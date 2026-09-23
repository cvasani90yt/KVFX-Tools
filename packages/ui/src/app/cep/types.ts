/**
 * The CEP surface we depend on, declared ourselves.
 *
 * Adobe ships `CSInterface.js`, but it is a thin wrapper over `__adobe_cep__`
 * and vendoring it would pull third-party source into an originally-authored
 * product for no functional gain. We talk to the underlying host object
 * directly and declare only what we use, so the CEP dependency stays small and
 * auditable — which is also what makes ADR-0001's "one adapter to replace"
 * claim true rather than aspirational.
 */

export interface AdobeCepHost {
  /** Evaluates ExtendScript in the host application. */
  evalScript(script: string, callback: (result: string) => void): void;
  /** JSON string describing the host application. */
  getHostEnvironment(): string;
  /** Extension id of this panel. */
  getExtensionId(): string;
}

declare global {
  interface Window {
    __adobe_cep__?: AdobeCepHost;
  }
}

/** CEP returns this literal string when the evaluated script throws. */
export const EVAL_SCRIPT_ERROR = "EvalScript error.";
