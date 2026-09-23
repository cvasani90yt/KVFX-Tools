import { type KvfxError, kvfxError, type Result, err, ok } from "@kvfx/core";
import {
  type BuildRequestInput,
  type HostResponse,
  ProtocolError,
  buildRequest,
  parseResponse,
} from "../protocol/envelope.js";
import { toExtendScriptLiteral } from "../protocol/literal.js";
import type { JsonValue } from "../protocol/json.js";
import type { HostTransport } from "./transport.js";

/**
 * Global the host bundle installs on `$.global`. Kept in one place because the
 * panel and the host must agree on it exactly.
 */
export const HOST_GLOBAL = "__kvfxHost";

/**
 * Extra time the panel waits beyond the host's own budget before giving up.
 *
 * The host polices `budgetMs` itself and aborts cleanly. This margin only covers
 * the `evalScript` round trip, so a hung host surfaces as a timeout instead of a
 * promise that never settles — but it is deliberately generous, because
 * After Effects can stall for reasons that have nothing to do with us (a modal
 * dialog, a render). Timing out here does not cancel host-side work.
 */
const TRANSPORT_MARGIN_MS = 4000;

export interface HostClientOptions {
  readonly transport: HostTransport;
  /** Injectable for tests; defaults to a counter-based id. */
  readonly nextId?: () => string;
}

export class HostClient {
  readonly #transport: HostTransport;
  readonly #nextId: () => string;
  #counter = 0;

  constructor(options: HostClientOptions) {
    this.#transport = options.transport;
    this.#nextId =
      options.nextId ??
      ((): string => {
        this.#counter += 1;
        return `r${String(this.#counter)}`;
      });
  }

  /**
   * Builds the ExtendScript source for a request.
   *
   * Exposed for tests and diagnostics: being able to see the exact source sent
   * to After Effects is the difference between a five-minute and a five-hour
   * debugging session, given ExtendScript has no usable debugger.
   */
  buildSource(input: Omit<BuildRequestInput, "id"> & { readonly id?: string }): string {
    const request = buildRequest({ ...input, id: input.id ?? this.#nextId() });
    const literal = toExtendScriptLiteral(request as unknown as JsonValue);
    return `${HOST_GLOBAL}.dispatch(${literal})`;
  }

  async send(
    input: Omit<BuildRequestInput, "id"> & { readonly id?: string },
  ): Promise<Result<JsonValue, KvfxError>> {
    let source: string;
    let request;
    try {
      request = buildRequest({ ...input, id: input.id ?? this.#nextId() });
      source = `${HOST_GLOBAL}.dispatch(${toExtendScriptLiteral(request as unknown as JsonValue)})`;
    } catch (cause) {
      return err(toKvfxError(cause));
    }

    let raw: string;
    try {
      raw = await withTimeout(
        this.#transport.evaluate(source),
        request.budgetMs + TRANSPORT_MARGIN_MS,
      );
    } catch (cause) {
      return err(toKvfxError(cause));
    }

    let response: HostResponse;
    try {
      response = parseResponse(raw);
    } catch (cause) {
      return err(toKvfxError(cause));
    }

    if (response.id !== request.id) {
      return err(
        kvfxError("transport_failure", "Host reply did not match the request it answered", {
          expected: request.id,
          received: response.id,
        }),
      );
    }

    return response.ok ? ok(response.result) : err(response.error);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ProtocolError(
          "budget_exceeded",
          `After Effects did not reply within ${String(ms)} ms`,
        ),
      );
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

function toKvfxError(cause: unknown): KvfxError {
  if (cause instanceof ProtocolError) {
    return kvfxError(cause.code, cause.message);
  }
  if (cause instanceof Error) {
    return kvfxError("transport_failure", cause.message);
  }
  return kvfxError("transport_failure", String(cause));
}
