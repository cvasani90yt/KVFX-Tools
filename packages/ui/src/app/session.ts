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
  type KvfxSettings,
  type PaletteEntry,
  type SelectionSnapshot,
  buildPalette,
  createProductionCommandRegistry,
  decodeSnapshot,
  migrateSettings,
  pruneUnknownCommands,
  recordUsage,
  setUiSetting,
  toggleFavourite,
  type AlignReference,
} from "@kvfx/core";
import { createCepTransport, isRunningInCep } from "./cep/cep-transport.js";
import { type SettingsStore, createMemoryStore, createSettingsStore } from "./cep/settings-store.js";

/**
 * Owns the connection to After Effects, the user's settings, and the palette
 * state derived from both.
 *
 * The panel never assumes it knows the selection: it refreshes on focus, after
 * every command, and on request, because After Effects emits no events
 * (ADR-0002). Commands target the live selection, so a briefly stale display
 * can never cause the wrong layers to be modified.
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
  readonly settings: KvfxSettings;
  readonly query: string;
  readonly selectedIndex: number;
  readonly lastOutcome: CommandOutcome | undefined;
  readonly busy: boolean;
  /** Settings-load notes, shown in diagnostics rather than as an error. */
  readonly notices: readonly string[];
}

/**
 * How long to wait before writing settings.
 *
 * Favourites and usage change on every command, and `cep.fs` writes are
 * synchronous. Debouncing keeps a burst of commands from becoming a burst of
 * file writes; a flush on blur and on panel unload means nothing is lost.
 */
const PERSIST_DELAY_MS = 800;

const registry = createProductionCommandRegistry();

function asString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value : fallback;
}

export class Session {
  #client: HostClient | undefined;
  readonly #store: SettingsStore;
  readonly #onChange: (state: SessionState) => void;
  #persistTimer: ReturnType<typeof setTimeout> | undefined;
  #settingsWritable = true;
  #state: SessionState;

  constructor(onChange: (state: SessionState) => void, store?: SettingsStore) {
    this.#onChange = onChange;
    this.#store = store ?? createSettingsStore() ?? createMemoryStore();

    const loaded = migrateSettings(this.#store.read());
    this.#settingsWritable = loaded.writable;

    const knownIds = new Set(registry.all().map((command) => command.id));
    const pruned = pruneUnknownCommands(loaded.settings, knownIds);

    this.#state = {
      connection: { status: "checking" },
      snapshot: EMPTY_SNAPSHOT,
      settings: pruned,
      query: "",
      selectedIndex: 0,
      lastOutcome: undefined,
      busy: false,
      notices: loaded.warnings,
    };
  }

  get state(): SessionState {
    return this.#state;
  }

  get settingsLocation(): string {
    return this.#store.location();
  }

  context(): CommandContext {
    const facts = this.#state.connection.status === "connected" ? this.#state.connection.facts : undefined;
    return { snapshot: this.#state.snapshot, aeVersion: facts?.aeVersion ?? "0" };
  }

  /** The ranked palette for the current query, selection and settings. */
  entries(): readonly PaletteEntry[] {
    return buildPalette({
      registry,
      context: this.context(),
      settings: this.#state.settings,
      query: this.#state.query,
      nowMs: Date.now(),
    });
  }

  registryGet(commandId: string): Command | undefined {
    return registry.get(commandId);
  }

  setSelectedIndex(index: number): void {
    if (index === this.#state.selectedIndex) return;
    this.#set({ selectedIndex: index });
  }

  selectedEntry(): PaletteEntry | undefined {
    const list = this.entries();
    return list[Math.min(this.#state.selectedIndex, list.length - 1)];
  }

  #set(patch: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#onChange(this.#state);
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  #updateSettings(next: KvfxSettings): void {
    this.#set({ settings: next });
    if (!this.#settingsWritable) return;

    if (this.#persistTimer !== undefined) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.flushSettings();
    }, PERSIST_DELAY_MS);
  }

  /** Writes pending settings immediately. Safe to call at any time. */
  flushSettings(): void {
    if (this.#persistTimer !== undefined) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = undefined;
    }
    if (!this.#settingsWritable) return;

    const result = this.#store.write(this.#state.settings);
    if (!result.ok && !this.#state.notices.includes(result.reason)) {
      // Losing preferences is annoying; losing them silently is worse.
      this.#set({ notices: [...this.#state.notices, result.reason] });
    }
  }

  toggleFavourite(commandId: string): void {
    this.#updateSettings(toggleFavourite(this.#state.settings, commandId));
  }

  setActiveTab(tabId: string): void {
    if (tabId === this.#state.settings.ui.activeTab) return;
    this.#updateSettings(setUiSetting(this.#state.settings, "activeTab", tabId));
  }

  setAlignReference(reference: AlignReference): void {
    if (reference === this.#state.settings.ui.alignReference) return;
    this.#updateSettings(setUiSetting(this.#state.settings, "alignReference", reference));
  }

  /**
   * Availability for every command, including the ones hidden from the palette.
   *
   * The align grid drives hidden variants, so it cannot rely on the palette's
   * filtered list to know whether a button should be enabled.
   */
  availability(): { ids: Set<string>; reasons: Map<string, string> } {
    const ids = new Set<string>();
    const reasons = new Map<string, string>();

    for (const entry of registry.resolve(this.context())) {
      if (entry.available) ids.add(entry.command.id);
      else if (entry.reason !== undefined) reasons.set(entry.command.id, entry.reason);
    }

    return { ids, reasons };
  }

  // -------------------------------------------------------------------------
  // Palette interaction
  // -------------------------------------------------------------------------

  setQuery(query: string): void {
    this.#set({ query, selectedIndex: 0 });
  }

  moveSelection(delta: number): void {
    const count = this.entries().length;
    if (count === 0) return;
    const next = (this.#state.selectedIndex + delta + count) % count;
    this.#set({ selectedIndex: next });
  }

  // -------------------------------------------------------------------------
  // Host
  // -------------------------------------------------------------------------

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
    if (result.ok) this.#set({ snapshot: decodeSnapshot(result.value) });
  }

  /**
   * Runs a command: build its plan, send it as one request, re-read selection.
   *
   * The whole plan crosses the bridge once and executes inside one undo group,
   * so the user gets exactly one entry in Edit ▸ Undo however many operations
   * the command needed (ADR-0006).
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

    // A measured command reads real geometry out of After Effects before it can
    // decide anything. The probe is read-only and opens no undo group; the plan
    // built from it addresses layers by id and carries explicit values, so a
    // selection change between the two steps cannot misplace anything.
    let plan;
    if (command.kind === "measured") {
      const probe = command.probe(this.context());
      const measured = await client.send({ kind: "query", op: probe.op, args: probe.args });
      if (!measured.ok) {
        this.#set({
          busy: false,
          lastOutcome: { commandName: command.name, ok: false, message: measured.error.message },
        });
        return;
      }
      plan = command.plan(this.context(), measured.value);
    } else {
      plan = command.plan(this.context());
    }

    // Nothing to do is a real outcome, not a failure: aligning one layer that
    // is already in place, or distributing fewer than three layers.
    if (plan.steps.length === 0) {
      this.#set({
        busy: false,
        lastOutcome: { commandName: command.name, ok: true, message: "Nothing to change" },
      });
      return;
    }

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

    // Usage is recorded only on success, so a command that failed because of a
    // precondition does not climb the rankings.
    if (result.ok) this.#updateSettings(recordUsage(this.#state.settings, command.id, Date.now()));

    await this.refreshSelection();
    this.#set({ busy: false });
  }

  async runSelected(): Promise<void> {
    const entry = this.selectedEntry();
    if (entry !== undefined && entry.available) await this.run(entry.command);
  }
}
