import { expect } from "vitest";
import {
  type CommandContext,
  type JsonValue,
  type OperationPlan,
  createProductionCommandRegistry,
  decodeSnapshot,
} from "@kvfx/core";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import type { MockAe } from "./mock-ae.js";

/**
 * Runs one shipped command end to end — snapshot, availability, probe, plan,
 * execute — exactly as the panel does, against a mock After Effects.
 */

export interface Reply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export function send(ae: MockAe, request: Record<string, unknown>): Reply {
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  return JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: "test", ...request })) as Reply;
}

export function contextFor(ae: MockAe, params: Record<string, JsonValue> = {}): CommandContext {
  const snapshot = send(ae, { kind: "query", op: "kvfx.op.selection.snapshot", args: {}, budgetMs: 250 });
  return { snapshot: decodeSnapshot(snapshot.result as JsonValue), aeVersion: "26.0.1x45", params };
}

export function planFor(ae: MockAe, id: string, params: Record<string, JsonValue> = {}): OperationPlan {
  const command = createProductionCommandRegistry().get(id);
  if (command === undefined) throw new Error(`No command ${id}`);
  const ctx = contextFor(ae, params);
  const availability = command.canExecute(ctx);
  if (!availability.available) throw new Error(`${id} unavailable: ${availability.reason}`);
  if (command.kind === "measured") {
    const probe = command.probe(ctx);
    const measured = send(ae, { kind: "query", op: probe.op, args: probe.args, budgetMs: 1000 });
    if (!measured.ok) throw new Error(`probe failed: ${measured.error?.message ?? "?"}`);
    return command.plan(ctx, measured.result as JsonValue);
  }
  return command.plan(ctx);
}

export function execute(ae: MockAe, plan: OperationPlan): Reply {
  return send(ae, {
    kind: "plan",
    op: "kvfx.op.core.plan",
    args: { steps: plan.steps as unknown as JsonValue },
    undoGroup: plan.undoGroup,
    budgetMs: plan.budgetMs ?? 5000,
  });
}

/** Plans and runs a command, failing the test if the host refuses it. */
export function runCommand(ae: MockAe, id: string, params: Record<string, JsonValue> = {}): Reply {
  const plan = planFor(ae, id, params);
  const reply = execute(ae, plan);
  expect(reply.ok, reply.error?.message).toBe(true);
  return reply;
}

/** Runs a raw plan of steps. */
export function runSteps(ae: MockAe, steps: OperationPlan["steps"]): Reply {
  return execute(ae, { undoGroup: "KVFX Tools — test", steps });
}
