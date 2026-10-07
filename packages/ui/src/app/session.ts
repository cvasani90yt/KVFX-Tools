import {
  HostClient,
  PLAN_OPERATION_ID,
  TransportUnavailableError,
  type HostTransport,
} from "@kvfx/bridge";
import {
  type AlignReference,
  type Command,
  type CommandContext,
  EMPTY_SNAPSHOT,
  type JsonObject,
  type JsonValue,
  type KvfxError,
  type KvfxSettings,
  type PaletteEntry,
  type PlanStep,
  type SelectionSnapshot,
  type UiSettings,
  buildPalette,
  createProductionCommandRegistry,
  decodeSnapshot,
  defaultSettings,
  deleteEase,
  migrateSettings,
  pruneUnknownCommands,
  recordUsage,
  saveEase,
  setToolParams,
  setUiSetting,
  summarizeResult,
  toggleFavourite,
  toggleGroupCollapsed,
  toggleListEntry,
  userMessage,
} from "@kvfx/core";
import { createCepTransport, isRunningInCep } from "./cep/cep-transport.js";
import { type SettingsStore, createMemoryStore, createSettingsStore } from "./cep/settings-store.js";

/**
 * Owns the connection to After Effects, the user's settings, and every call
 * the panel makes to the host.
 *
 * The panel never assumes it knows the selection: it refreshes on focus, after
 * every command, and on request, because After Effects emits no events
 * (ADR-0002). Commands target the live selection or ids from a fresh probe, so
 * a briefly stale display can never cause the wrong layers to be modified.
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

export interface Outcome {
  readonly title: string;
  readonly ok: boolean;
  readonly message: string;
  /** Lets the toast restart its timer when the same message repeats. */
  readonly serial: number;
}

export interface SessionState {
  readonly connection: ConnectionState;
  readonly snapshot: SelectionSnapshot;
  readonly settings: KvfxSettings;
  readonly busy: boolean;
  readonly lastOutcome: Outcome | undefined;
  /** Bytes After Effects reported in use at the last refresh. */
  readonly memoryBytes: number | undefined;
  /** Settings-load notes, shown in diagnostics rather than as an error. */
  readonly notices: readonly string[];
}

export type QueryResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly message: string };

/**
 * How long to wait before writing settings.
 *
 * Favourites, usage and tool parameters change constantly, and `cep.fs`
 * writes are synchronous. Debouncing keeps a burst of changes from becoming a
 * burst of file writes; a flush on blur and on panel unload means nothing is lost.
 */
const PERSIST_DELAY_MS = 800;

const registry = createProductionCommandRegistry();
const GIB = 1_073_741_824;

function asString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value : fallback;
}

export class Session {
  #client: HostClient | undefined;
  readonly #store: SettingsStore;
  readonly #onChange: (state: SessionState) => void;
  #persistTimer: ReturnType<typeof setTimeout> | undefined;
  #settingsWritable = true;
  #serial = 0;
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
      busy: false,
      lastOutcome: undefined,
      memoryBytes: undefined,
      notices: loaded.warnings,
    };
  }

  get state(): SessionState {
    return this.#state;
  }

  get settingsLocation(): string {
    return this.#store.location();
  }

  get connected(): boolean {
    return this.#client !== undefined && this.#state.connection.status === "connected";
  }

  context(params?: JsonObject): CommandContext {
    const facts = this.#state.connection.status === "connected" ? this.#state.connection.facts : undefined;
    return {
      snapshot: this.#state.snapshot,
      aeVersion: facts?.aeVersion ?? "0",
      ...(params === undefined ? {} : { params }),
    };
  }

  command(commandId: string): Command | undefined {
    return registry.get(commandId);
  }

  /** The ranked palette for a query against the current selection and settings. */
  entries(query: string): readonly PaletteEntry[] {
    return buildPalette({
      registry,
      context: this.context(),
      settings: this.#state.settings,
      query,
      nowMs: Date.now(),
    });
  }

  /** Availability for every command, so each button can enable honestly. */
  availability(): { ids: Set<string>; reasons: Map<string, string> } {
    const ids = new Set<string>();
    const reasons = new Map<string, string>();
    for (const entry of registry.resolve(this.context())) {
      if (entry.available) ids.add(entry.command.id);
      else if (entry.reason !== undefined) reasons.set(entry.command.id, entry.reason);
    }
    return { ids, reasons };
  }

  #set(patch: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#onChange(this.#state);
  }

  /** Shows a one-line result to the user. */
  report(title: string, ok: boolean, message: string): void {
    this.#serial += 1;
    this.#set({ lastOutcome: { title, ok, message, serial: this.#serial } });
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

  setUi<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
    if (this.#state.settings.ui[key] === value) return;
    this.#updateSettings(setUiSetting(this.#state.settings, key, value));
  }

  setActiveTab(tabId: string): void {
    this.setUi("activeTab", tabId);
  }

  setAlignReference(reference: AlignReference): void {
    this.setUi("alignReference", reference);
  }

  toggleGroup(groupId: string): void {
    this.#updateSettings(toggleGroupCollapsed(this.#state.settings, groupId));
  }

  toggleFavourite(commandId: string): void {
    this.#updateSettings(toggleFavourite(this.#state.settings, commandId));
  }

  toggleHiddenTab(tabId: string): void {
    this.setUi("hiddenTabs", toggleListEntry(this.#state.settings.ui.hiddenTabs, tabId));
  }

  toolParams(toolId: string): JsonObject {
    return this.#state.settings.ui.toolParams[toolId] ?? {};
  }

  setToolParams(toolId: string, params: JsonObject): void {
    this.#updateSettings(setToolParams(this.#state.settings, toolId, params));
  }

  saveEase(name: string, bezier: readonly [number, number, number, number]): void {
    this.#updateSettings(saveEase(this.#state.settings, name, bezier));
  }

  deleteEase(name: string): void {
    this.#updateSettings(deleteEase(this.#state.settings, name));
  }

  /** Restores every preference to its default. Usage history goes too. */
  resetSettings(): void {
    this.#updateSettings(defaultSettings());
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
    await this.refreshMemory();
    this.#set({ busy: false });
  }

  async refreshSelection(): Promise<void> {
    if (!this.connected) return;
    const result = await this.query("kvfx.op.selection.snapshot");
    if (result.ok) this.#set({ snapshot: decodeSnapshot(result.value) });
  }

  async refreshMemory(): Promise<void> {
    if (!this.connected) return;
    const result = await this.query("kvfx.op.system.memory");
    if (!result.ok) return;
    const bytes = (result.value as { bytes?: unknown } | null)?.bytes;
    if (typeof bytes === "number" && bytes !== this.#state.memoryBytes) this.#set({ memoryBytes: bytes });
  }

  async purge(target: "image" | "all"): Promise<void> {
    const result = await this.query("kvfx.op.system.purge", { target });
    if (!result.ok) {
      this.report("Purge", false, result.message);
      return;
    }
    const value = result.value as { bytesBefore?: number; bytesAfter?: number } | null;
    const freed = (value?.bytesBefore ?? 0) - (value?.bytesAfter ?? 0);
    this.report(
      "Purge",
      true,
      freed > 0 ? `Freed ${(freed / GIB).toFixed(1)} GB` : "Caches purged",
    );
    if (typeof value?.bytesAfter === "number") this.#set({ memoryBytes: value.bytesAfter });
  }

  /** A read-only call. Never opens an undo group. */
  async query(op: string, args: JsonObject = {}, budgetMs?: number): Promise<QueryResult> {
    const client = this.#client;
    if (client === undefined) return { ok: false, message: "Not connected to After Effects." };
    const result = await client.send({ kind: "query", op, args, ...(budgetMs === undefined ? {} : { budgetMs }) });
    return result.ok ? { ok: true, value: result.value ?? null } : { ok: false, message: userMessage(result.error) };
  }

  /**
   * Runs steps as one plan: one round trip, one undo group, one entry in
   * Edit ▸ Undo however many operations it took (ADR-0006).
   */
  async runPlan(title: string, steps: readonly PlanStep[], budgetMs?: number): Promise<JsonValue | undefined> {
    const client = this.#client;
    if (client === undefined || this.#state.busy) return undefined;
    if (steps.length === 0) {
      this.report(title, true, "Nothing to change");
      return undefined;
    }

    this.#set({ busy: true });
    const result = await client.send({
      kind: "plan",
      op: PLAN_OPERATION_ID,
      args: {
        steps: steps.map((step) =>
          step.bind === undefined ? { op: step.op, args: step.args } : { op: step.op, args: step.args, bind: step.bind },
        ),
      },
      undoGroup: `KVFX Tools — ${title}`,
      ...(budgetMs === undefined ? {} : { budgetMs }),
    });

    this.report(title, result.ok, result.ok ? summarizeResult(result.value ?? null) : userMessage(result.error));
    this.#set({ busy: false });
    await this.refreshSelection();
    return result.ok ? (result.value ?? null) : undefined;
  }

  /**
   * Runs a command: resolve parameters, probe if it must, plan, execute as one
   * plan, then re-read the selection.
   *
   * Parameters are the command's defaults from settings, overlaid by whatever
   * the invoking control supplied.
   */
  async run(commandOrId: Command | string, params?: JsonObject): Promise<boolean> {
    const command = typeof commandOrId === "string" ? registry.get(commandOrId) : commandOrId;
    if (command === undefined || this.#client === undefined || this.#state.busy) return false;

    const merged: JsonObject = { ...(command.defaultParams?.(this.#state.settings.ui) ?? {}), ...(params ?? {}) };
    const ctx = this.context(merged);

    const availability = command.canExecute(ctx);
    if (!availability.available) {
      this.report(command.name, false, availability.reason);
      return false;
    }

    let plan;
    if (command.kind === "measured") {
      // The probe is read-only and opens no undo group; the plan built from it
      // addresses layers by id, so a selection change in between cannot
      // misplace anything.
      const probe = command.probe(ctx);
      const measured = await this.query(probe.op, probe.args);
      if (!measured.ok) {
        this.report(command.name, false, measured.message);
        return false;
      }
      plan = command.plan(ctx, measured.value);
    } else {
      plan = command.plan(ctx);
    }

    const before = this.#serial;
    const value = await this.runPlan(command.name, plan.steps, plan.budgetMs);
    const ok = value !== undefined || (plan.steps.length === 0 && this.#serial > before);

    // Usage is recorded only on success, so a command that failed because of a
    // precondition does not climb the rankings.
    if (value !== undefined) this.#updateSettings(recordUsage(this.#state.settings, command.id, Date.now()));
    return ok;
  }
}
