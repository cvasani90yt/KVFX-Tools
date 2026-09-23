import type { AeEnvironment } from "../ae/environment.js";
import type { HostJson } from "./serialize.js";

export interface OperationContext {
  readonly env: AeEnvironment;
  readonly args: { [key: string]: HostJson };
  /** Epoch milliseconds after which the operation must stop and yield. */
  readonly deadlineMs: number;
}

export interface Operation {
  /** Fully qualified id, e.g. "kvfx.op.system.ping". */
  readonly id: string;
  /**
   * Whether the operation modifies the project. Mutating operations require an
   * undo group; read-only ones must never open one.
   */
  readonly mutates: boolean;
  /** Minimum After Effects version, or undefined when unconstrained. */
  readonly aeMin?: string;
  run(ctx: OperationContext): HostJson;
}

export interface OperationRegistry {
  register(op: Operation): void;
  lookup(id: string): Operation | undefined;
  ids(): string[];
}

export function createRegistry(operations: Operation[]): OperationRegistry {
  const byId: { [id: string]: Operation } = {};
  const order: string[] = [];

  const registry: OperationRegistry = {
    register: function (op: Operation): void {
      if (byId[op.id]) {
        // A duplicate id means two operations would answer the same request
        // depending on load order. Fail loudly at startup, not at 2am.
        throw new Error(`Duplicate operation id: ${op.id}`);
      }
      byId[op.id] = op;
      order[order.length] = op.id;
    },
    lookup: function (id: string): Operation | undefined {
      return Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : undefined;
    },
    ids: function (): string[] {
      return order.slice(0);
    },
  };

  for (let i = 0; i < operations.length; i += 1) {
    registry.register(operations[i] as Operation);
  }
  return registry;
}
