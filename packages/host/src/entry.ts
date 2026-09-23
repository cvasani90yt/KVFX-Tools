import { createLiveEnvironment } from "./ae/live-environment.js";
import { createProductionRegistry } from "./ops/index.js";
import { createDispatcher } from "./runtime/dispatcher.js";

/**
 * Host bundle entry point.
 *
 * After Effects loads this file via the CEP manifest's `<ScriptPath>` when the
 * panel opens. It installs exactly one property on the shared ExtendScript
 * global — every script running in After Effects shares that scope, so adding
 * more than we need would be poor manners at best and a collision at worst.
 */
(function install(): void {
  const globalScope = $.global;
  const env = createLiveEnvironment();
  const dispatch = createDispatcher(createProductionRegistry(), env);

  globalScope["__kvfxHost"] = {
    dispatch: dispatch,
  };
})();
