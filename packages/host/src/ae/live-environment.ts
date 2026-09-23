import { nowMs } from "../runtime/es3.js";
import type { AeEnvironment } from "./environment.js";

/** The real environment, backed by After Effects' own globals. */
export function createLiveEnvironment(): AeEnvironment {
  return {
    version: function (): string {
      return app.version;
    },
    buildName: function (): string {
      return app.buildName;
    },
    language: function (): string {
      return app.isoLanguage;
    },
    os: function (): string {
      return $.os;
    },
    engineVersion: function (): string {
      return $.version;
    },
    beginUndoGroup: function (name: string): void {
      app.beginUndoGroup(name);
    },
    endUndoGroup: function (): void {
      app.endUndoGroup();
    },
    nowMs: nowMs,
  };
}
