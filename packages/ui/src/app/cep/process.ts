import { type AdobeCepProcessResult, CEP_FS_NO_ERROR } from "./types.js";

/**
 * Starting a program from the panel, through `cep.process`.
 *
 * The program belongs to the panel's own process, so After Effects never
 * waits on it — unlike a command After Effects runs, which holds After
 * Effects until the command lets go. Used only for the system colour picker.
 */

/** CEP's results are objects; tolerate a JSON string too. */
function read<T>(result: unknown): AdobeCepProcessResult<T> | undefined {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  return typeof value === "object" && value !== null && typeof (value as { err?: unknown }).err === "number"
    ? (value as AdobeCepProcessResult<T>)
    : undefined;
}

/** Whether the panel can start programs itself. */
export function processesAvailable(): boolean {
  return typeof window.cep?.process?.createProcess === "function";
}

/** Starts `path` with `args`; the pid, or undefined when it couldn't start. */
export function startProcess(path: string, args: readonly string[]): number | undefined {
  const api = window.cep?.process;
  if (typeof api?.createProcess !== "function") return undefined;
  try {
    const result = read<number>(api.createProcess(path, ...args));
    const pid = result?.data;
    return result?.err === CEP_FS_NO_ERROR && typeof pid === "number" && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the process is still running; undefined when CEP can't say. */
export function processRunning(pid: number): boolean | undefined {
  const api = window.cep?.process;
  if (typeof api?.isRunning !== "function") return undefined;
  try {
    const result = read<boolean>(api.isRunning(pid));
    return result?.err === CEP_FS_NO_ERROR && typeof result.data === "boolean" ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Ends the process, if CEP can; nothing happens when it already ended. */
export function stopProcess(pid: number): void {
  try {
    window.cep?.process?.terminate?.(pid);
  } catch {
    // Already gone, or CEP can't: either way there's nothing more to do.
  }
}
