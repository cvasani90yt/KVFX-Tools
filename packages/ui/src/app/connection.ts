import { HostClient, TransportUnavailableError } from "@kvfx/bridge";
import type { KvfxError } from "@kvfx/core";
import { createCepTransport, isRunningInCep } from "./cep/index.js";

export interface HostFacts {
  readonly hostBundleVersion: string;
  readonly aeVersion: string;
  readonly aeBuild: string;
  readonly aeLanguage: string;
  readonly os: string;
  readonly engineVersion: string;
}

export type ConnectionState =
  | { readonly status: "checking" }
  /** Running outside After Effects — e.g. the page opened in a browser. */
  | { readonly status: "no-host"; readonly message: string }
  | { readonly status: "connected"; readonly facts: HostFacts; readonly roundTripMs: number }
  | { readonly status: "failed"; readonly error: KvfxError };

function asString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Verifies the panel → After Effects channel end to end.
 *
 * This is the one thing the Phase 2 shell does, and it is not a placeholder:
 * a working round trip is the precondition for every command the product will
 * ever run, and its failure modes (host script not loaded, version mismatch,
 * panel opened outside After Effects) are exactly the ones users hit first.
 */
export async function checkConnection(): Promise<ConnectionState> {
  if (!isRunningInCep()) {
    return {
      status: "no-host",
      message:
        "KVFX Tools is not running inside After Effects. Open it from Window ▸ Extensions ▸ KVFX Tools.",
    };
  }

  let client: HostClient;
  try {
    client = new HostClient({ transport: createCepTransport() });
  } catch (cause) {
    if (cause instanceof TransportUnavailableError) {
      return { status: "no-host", message: cause.message };
    }
    throw cause;
  }

  const startedAt = performance.now();
  const result = await client.send({ kind: "query", op: "kvfx.op.system.ping" });
  const roundTripMs = Math.round(performance.now() - startedAt);

  if (!result.ok) {
    return { status: "failed", error: result.error };
  }

  const raw = (result.value ?? {}) as Record<string, unknown>;
  return {
    status: "connected",
    roundTripMs,
    facts: {
      hostBundleVersion: asString(raw["hostBundleVersion"]),
      aeVersion: asString(raw["aeVersion"]),
      aeBuild: asString(raw["aeBuild"]),
      aeLanguage: asString(raw["aeLanguage"]),
      os: asString(raw["os"]),
      engineVersion: asString(raw["engineVersion"]),
    },
  };
}
