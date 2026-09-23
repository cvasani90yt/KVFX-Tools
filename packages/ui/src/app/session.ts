import {
  HostClient,
  PLAN_OPERATION_ID,
  TransportUnavailableError,
  type HostTransport,
} from "@kvfx/bridge";
import {
  type Command,
  type CommandContext,
  EMPTY_SNAPSHOT,
  type KvfxError,
  type SelectionSnapshot,
  createProductionCommandRegistry,
  decodeSnapshot,
} from "@kvfx/core";
import { createCepTransport, isRunningInCep } from "./cep/index.js";

/**
 * Owns the connection to After Effects and everything derived from it.
 *
 * The panel never assumes it knows the selection: it refreshes on focus, after
 * every command, and on explicit request, because After Effects emits no events
 * (ADR-0002). Commands themselves target the live selection, so a slightly
 * stale display can never cause the wrong layers to be modified.
 */

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
  | { readonly status: "no-host"; readonly message: string }
  | { readonly status: "connected"; readonly facts: HostFacts; readonly roundTripMs: number }
  | { readonly status: "failed"; readonly error: KvfxError };

export interface CommandOutcome {
  readonly commandName: string;
  readonly ok: boolean;
  readonly message: string;
}

export interface SessionState {
  readonly connection: ConnectionState;
  readonly snapshot: SelectionSnapshot;
  readonly lastOutcome: CommandOutcome | undefined;
  readonly busy: boolean;
}

const registry = createProductionCommandRegistry();

function asString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value : fallback;
}

export class Session {
  #client: HostClient | undefined;
  #state: SessionState = {
    connection: { status: "checking" },
    snapshot: EMPTY_SNAPSHOT,
    lastOutcome: undefined,
    busy: false,
  };

  readonly #onChange: (state: SessionState) => void;

  constructor(onChange: (state: SessionState) => void) {
    this.#onChange = onChange;
  }

  get state(): SessionState {
    return this.#state;
  }

  get registry(): ReturnType<typeof createProductionCommandRegistry> {
    return registry;
  }

  context(): CommandContext {
    const facts = this.#state.connection.status === "connected" ? this.#state.connection.facts : undefined;
    return { snapshot: this.#state.snapshot, aeVersion: facts?.aeVersion ?? "0" };
  }

  #set(patch: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#onChange(this.#state);
  }

  #transport(): HostTransport | { readonly unavailable: string } {
    if (!isRunningInCep()) {
      return {
        unavailable:
          "KVFX Tools is not running inside After Effects. Open it from Window ▸ Extensions ▸ KVFX Tools.",
      };
    }
    try {
      return createCepTransport();
    } catch (cause) {
      if (cause instanceof TransportUnavailableError) return { unavailable: cause.message };
      throw cause;
    }
  }

  /** Verifies the channel and reads the current selection. */
  async connect(): Promise<void> {
    this.#set({ connection: { status: "checking" }, busy: true });

    const transport = this.#transport();
    if ("unavailable" in transport) {
      this.#set({
        connection: { status: "no-host", message: transport.unavailable },
        snapshot: EMPTY_SNAPSHOT,
        busy: false,
      });
      return;
    }

    const client = new HostClient({ transport });
    this.#client = client;

    const startedAt = performance.now();
    const ping = await client.send({ kind: "query", op: "kvfx.op.system.ping" });
    const roundTripMs = Math.round(performance.now() - startedAt);

    if (!ping.ok) {
      this.#set({ connection: { status: "failed", error: ping.error }, busy: false });
      return;
    }

    const raw = (ping.value ?? {}) as Record<string, unknown>;
    this.#set({
      connection: {
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
      },
    });

    await this.refreshSelection();
    this.#set({ busy: false });
  }

  async refreshSelection(): Promise<void> {
    const client = this.#client;
    if (client === undefined || this.#state.connection.status !== "connected") return;

    const result = await client.send({ kind: "query", op: "kvfx.op.selection.snapshot" });
    if (result.ok) {
      this.#set({ snapshot: decodeSnapshot(result.value) });
    }
  }

  /**
   * Runs a command: build its plan, send it as one request, re-read selection.
   *
   * The whole plan crosses the bridge once and executes inside one undo group,
   * so the user gets exactly one entry in Edit ▸ Undo no matter how many
   * operations the command needed (ADR-0006).
   */
  async run(command: Command): Promise<void> {
    const client = this.#client;
    if (client === undefined || this.#state.busy) return;

    const availability = command.canExecute(this.context());
    if (!availability.available) {
      this.#set({
        lastOutcome: { commandName: command.name, ok: false, message: availability.reason },
      });
      return;
    }

    this.#set({ busy: true, lastOutcome: undefined });

    const plan = command.plan(this.context());
    const result = await client.send({
      kind: "plan",
      op: PLAN_OPERATION_ID,
      args: { steps: plan.steps.map((step) => ({ op: step.op, args: step.args })) },
      undoGroup: plan.undoGroup,
    });

    this.#set({
      lastOutcome: {
        commandName: command.name,
        ok: result.ok,
        message: result.ok ? "Done" : result.error.message,
      },
    });

    await this.refreshSelection();
    this.#set({ busy: false });
  }
}
