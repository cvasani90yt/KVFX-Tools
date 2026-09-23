import type { Command, CommandContext } from "./types.js";

/**
 * The command registry.
 *
 * Registration is static and declarative — a command is in the list or it does
 * not exist. No dynamic discovery, no side-effectful imports, so the full set of
 * things the product can do is auditable by reading one file, and startup cost
 * does not grow with a plugin scan.
 */

export interface AvailableCommand {
  readonly command: Command;
  readonly available: boolean;
  /** Present when `available` is false; safe to show to the user. */
  readonly reason: string | undefined;
}

export interface CommandRegistry {
  all(): readonly Command[];
  get(id: string): Command | undefined;
  byCategory(category: string): readonly Command[];
  /**
   * Every command with its availability resolved against the current context.
   *
   * Unavailable commands are returned rather than hidden: a palette that makes
   * entries vanish teaches the user nothing, while one that shows "Select a
   * layer first" teaches them the rule once.
   */
  resolve(ctx: CommandContext): readonly AvailableCommand[];
}

/** Command ids: `kvfx.<group>.<name>`, lowerCamelCase per segment. */
const ID_PATTERN = /^kvfx\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

export function createCommandRegistry(commands: readonly Command[]): CommandRegistry {
  const byId = new Map<string, Command>();
  const ordered: Command[] = [];

  for (const command of commands) {
    if (!ID_PATTERN.test(command.id)) {
      throw new Error(`Malformed command id: ${command.id}`);
    }
    if (byId.has(command.id)) {
      // Two commands answering one id would resolve by import order — a bug that
      // only shows up after a refactor moves a file.
      throw new Error(`Duplicate command id: ${command.id}`);
    }
    byId.set(command.id, command);
    ordered.push(command);
  }

  return {
    all: () => ordered,
    get: (id) => byId.get(id),
    byCategory: (category) => ordered.filter((c) => c.category === category),
    resolve: (ctx) =>
      ordered.map((command) => {
        const availability = command.canExecute(ctx);
        return {
          command,
          available: availability.available,
          reason: availability.available ? undefined : availability.reason,
        };
      }),
  };
}
