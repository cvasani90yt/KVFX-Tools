/**
 * Transport abstraction for the panel → After Effects channel.
 *
 * The only real implementation is CEP's `evalScript`, and per ADR-0001 that
 * lives in `@kvfx/ui` behind the CEP adapter so this package stays testable and
 * so a future UXP port replaces one module. Tests supply a fake transport.
 */
export interface HostTransport {
  /** Evaluates ExtendScript source in the host and resolves with its reply. */
  evaluate(source: string): Promise<string>;
}

export class TransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportUnavailableError";
  }
}
