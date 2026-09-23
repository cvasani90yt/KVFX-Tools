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
  /**
   * Returns a `file://` URL for a well-known location. `"userData"` is the
   * platform application-data root, which is where our settings live
   * (ARCHITECTURE §10).
   */
  getSystemPath(pathType: string): string;
}

/**
 * CEP's built-in filesystem bridge, available without Node being enabled.
 *
 * Synchronous, but it runs in the panel's own process, so a settings write does
 * not freeze After Effects the way a host round-trip would.
 */
export interface AdobeCepFs {
  readFile(path: string): { data?: string; err: number };
  writeFile(path: string, data: string): { err: number };
  makedir(path: string): { err: number };
}

export interface AdobeCepUtil {
  registerExtensionUnloadCallback(callback: () => void): { err: number };
}

/** `cep.fs` returns 0 for success. We deliberately depend on nothing else. */
export const CEP_FS_NO_ERROR = 0;

/** The system path type for the platform application-data root. */
export const SYSTEM_PATH_USER_DATA = "userData";

declare global {
  interface Window {
    __adobe_cep__?: AdobeCepHost;
    cep?: { fs?: AdobeCepFs; util?: AdobeCepUtil };
  }
}

/** CEP returns this literal string when the evaluated script throws. */
export const EVAL_SCRIPT_ERROR = "EvalScript error.";
