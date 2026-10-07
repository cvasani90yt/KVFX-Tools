import { isArray } from "../../runtime/es3.js";
import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { layerById, readNumber, requireComp, skipped, targets } from "../raw.js";

/**
 * Structural layer edits: duplicate, attributes, selection, precompose, split.
 *
 * Each one acts on layers named by id (from a plan) or on After Effects' live
 * selection, skips what it cannot touch with a reason, and never removes a
 * layer the user made.
 */

const MAX_DUPLICATES = 200;
const MAX_LABEL = 16;

/** Duplicates each target `count` times. Copies land directly above their original. */
export const duplicateLayerOperation: Operation = {
  id: "kvfx.op.layer.duplicate",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const count = Math.floor(readNumber(ctx.args, "count", 1));
    if (count < 1 || count > MAX_DUPLICATES) {
      throw hostError(ErrorCode.InvalidArgument, "count must be between 1 and " + String(MAX_DUPLICATES) + ".");
    }

    const ids: number[] = [];
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      for (let c = 0; c < count; c += 1) ids[ids.length] = layer.duplicate().id;
    }

    return {
      ids: ids as unknown as HostJson,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/**
 * Sets plain layer attributes.
 *
 * The attribute list is closed on purpose: a generic "set any attribute"
 * would let a plan reach things like `source` or `stretch` that need their own
 * reasoning. Times are in seconds, as After Effects stores them.
 */
export const setLayerAttributesOperation: Operation = {
  id: "kvfx.op.layer.set",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const args = ctx.args;

    const label = args["label"];
    if (label !== undefined && (typeof label !== "number" || label < 0 || label > MAX_LABEL)) {
      throw hostError(ErrorCode.InvalidArgument, "label must be 0–16.");
    }

    let parent: AeRawLayer | null | undefined;
    const parentArg = args["parent"];
    if (parentArg === null) parent = null;
    else if (typeof parentArg === "number") {
      parent = layerById(comp, parentArg);
      if (!parent) throw hostError(ErrorCode.PreconditionFailed, "The parent layer no longer exists.");
    }

    let changed = 0;
    const skips: HostJson[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      if (parent && parent.id === layer.id) {
        skips[skips.length] = skipped(layer, "A layer cannot parent itself");
        continue;
      }

      if (typeof args["name"] === "string" && (args["name"]).length > 0) layer.name = args["name"];
      if (typeof label === "number") layer.label = label;
      // Start time first: it moves in and out points with it, so explicit
      // trims written after it land where the plan meant.
      if (typeof args["startTime"] === "number") layer.startTime = args["startTime"];
      if (typeof args["inPoint"] === "number") layer.inPoint = args["inPoint"];
      if (typeof args["outPoint"] === "number") layer.outPoint = args["outPoint"];
      if (typeof args["motionBlur"] === "boolean" && layer.motionBlur !== undefined) {
        layer.motionBlur = args["motionBlur"];
      }
      if (parent !== undefined) {
        // With jump: the layer keeps its place on screen, as when the user
        // drags the pick whip. Without it the layer would leap.
        if (typeof layer.setParentWithJump === "function") layer.setParentWithJump(parent);
        else layer.parent = parent;
      }
      changed += 1;
    }

    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/**
 * Changes which layers are selected.
 *
 * Selection is UI state rather than project data, but After Effects records
 * it in the undo history all the same, so this still runs as a mutation.
 */
export const selectLayersOperation: Operation = {
  id: "kvfx.op.layer.select",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const label = ctx.args["label"];
    const ids = ctx.args["ids"];
    const additive = ctx.args["mode"] === "add";

    let wanted: { [id: string]: boolean } | undefined;
    if (isArray(ids)) {
      wanted = {};
      const list = ids as HostJson[];
      for (let i = 0; i < list.length; i += 1) {
        const id = list[i];
        if (typeof id === "number") wanted[String(id)] = true;
      }
    } else if (typeof label !== "number") {
      throw hostError(ErrorCode.InvalidArgument, "Name the layers with ids or label.");
    }

    let count = 0;
    for (let i = 1; i <= comp.numLayers; i += 1) {
      const layer = comp.layer(i);
      const match = wanted ? wanted[String(layer.id)] === true : layer.label === label;
      if (match) {
        (layer as { selected: boolean }).selected = true;
        count += 1;
      } else if (!additive) {
        (layer as { selected: boolean }).selected = false;
      }
    }
    return { selectedCount: count };
  },
};

/**
 * Precomposes each target into its own composition.
 *
 * After Effects' own command can only put several layers into one precomp.
 * "Move all attributes" is used so the precomp is the layer's size and its
 * effects, masks and keyframes travel with it — the variant that leaves the
 * outer composition looking unchanged.
 */
export const precomposeEachOperation: Operation = {
  id: "kvfx.op.layer.precomposeEach",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const suffix = typeof ctx.args["suffix"] === "string" ? (ctx.args["suffix"]) : " Comp";

    // Ids are resolved before anything moves: indices shift with every precompose.
    const ids: number[] = [];
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) skips[skips.length] = skipped(layer, "Layer is locked");
      else ids[ids.length] = layer.id;
    }

    const created: number[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const layer = layerById(comp, ids[i] as number);
      if (!layer) continue;
      const index = layer.index;
      comp.layers.precompose([index], layer.name + suffix, true);
      // The precomp layer takes the original's place in the stack; the old
      // layer object now lives inside the new composition.
      created[created.length] = comp.layer(index).id;
    }

    return {
      ids: created as unknown as HostJson,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/**
 * Splits the selected layers at the current time.
 *
 * There is no scripting API for this, so it runs After Effects' own
 * Edit ▸ Split Layer command, looked up by its English name. On a localised
 * install the lookup fails and the operation says so rather than guessing a
 * numeric command id that changes between versions.
 */
export const splitLayerOperation: Operation = {
  id: "kvfx.op.layer.split",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    if (comp.selectedLayers.length === 0) {
      throw hostError(ErrorCode.PreconditionFailed, "Select the layers to split.");
    }
    const before = comp.numLayers;
    if (!ctx.env.runMenuCommand("Split Layer")) {
      throw hostError(
        ErrorCode.PreconditionFailed,
        "Split Layer could not be found in this language of After Effects. Use Edit ▸ Split Layer instead.",
      );
    }
    return { addedCount: comp.numLayers - before };
  },
};

interface DeepCopier {
  /** Copies a comp and, recursively, every comp nested in it. One copy per source. */
  copy(source: AeRawComp): AeRawComp;
  /** Retargets literal comp("…") references in every copy; call once, at the end. */
  finish(): { compCount: number; rewritten: number; dynamic: number };
}

/**
 * The shared engine of both deep-duplicate operations.
 *
 * Plain duplication shares nested comps, so editing the copy edits the
 * original — the classic template trap. Here each nested source comp is copied
 * once (a memo keeps shared precomps shared within the copy), and expressions
 * in the copies that name a copied comp with a literal `comp("…")` are pointed
 * at the copy. Expressions that build a comp name at runtime are left alone
 * and counted, because rewriting them would be guessing. Footage and solids
 * are shared, not copied: they are media, not structure.
 */
function createDeepCopier(env: OperationContext["env"]): DeepCopier {
  const memo: { [id: string]: AeRawComp } = {};
  const renamed: { from: string; to: string }[] = [];

  function copy(source: AeRawComp, depth: number): AeRawComp {
    const key = String(source.id);
    const existing = memo[key];
    if (existing) return existing;
    if (depth > MAX_NESTING) throw hostError(ErrorCode.PreconditionFailed, "Compositions are nested too deeply.");

    // Named before duplicating: After Effects gives the copy a "… 2" name of
    // its own, which would otherwise count as taken.
    const name = uniqueCompName(env, source.name);
    const duplicate = source.duplicate();
    duplicate.name = name;
    memo[key] = duplicate;
    renamed[renamed.length] = { from: source.name, to: duplicate.name };

    for (let i = 1; i <= duplicate.numLayers; i += 1) {
      const inner = duplicate.layer(i);
      const nested = inner.source;
      if (nested && env.isComp(nested) && typeof inner.replaceSource === "function") {
        inner.replaceSource(copy(nested as AeRawComp, depth + 1), false);
      }
    }
    return duplicate;
  }

  return {
    copy: function (source: AeRawComp): AeRawComp {
      return copy(source, 0);
    },
    finish: function (): { compCount: number; rewritten: number; dynamic: number } {
      let rewritten = 0;
      let dynamic = 0;
      for (const key in memo) {
        if (!Object.prototype.hasOwnProperty.call(memo, key)) continue;
        const duplicate = memo[key] as AeRawComp;
        for (let i = 1; i <= duplicate.numLayers; i += 1) {
          const counts = rewriteExpressions(duplicate.layer(i), renamed, env.leafPropertyType(), 0);
          rewritten += counts.rewritten;
          dynamic += counts.dynamic;
        }
      }
      return { compCount: renamed.length, rewritten: rewritten, dynamic: dynamic };
    },
  };
}

/**
 * Duplicates precomp layers in the open comp, each pointing at a deep copy of
 * its composition. The copy lands directly above the original layer.
 */
export const deepDuplicateOperation: Operation = {
  id: "kvfx.op.comp.deepDuplicate",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const env = ctx.env;
    const copier = createDeepCopier(env);
    const created: number[] = [];
    const names: string[] = [];
    const skips: HostJson[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      const source = layer.source;
      if (!source || !env.isComp(source) || typeof layer.replaceSource !== "function") {
        skips[skips.length] = skipped(layer, "Not a precomp layer");
        continue;
      }
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const duplicate = layer.duplicate();
      const copy = copier.copy(source as AeRawComp);
      (duplicate.replaceSource as NonNullable<AeRawLayer["replaceSource"]>)(copy, false);
      created[created.length] = duplicate.id;
      names[names.length] = copy.name;
    }

    const stats = copier.finish();
    return {
      ids: created as unknown as HostJson,
      createdNames: names as unknown as HostJson,
      compCount: stats.compCount,
      rewrittenExpressions: stats.rewritten,
      dynamicExpressions: stats.dynamic,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/**
 * Duplicates whole compositions, with everything nested inside them.
 *
 * Acts on the comps selected in the Project panel; with none selected there,
 * on the comp open in the viewer. Read live at execution, like every other
 * selection-driven operation (ADR-0002). The copies are new project items in
 * the same folder as their originals; nothing is placed in any timeline.
 */
export const deepDuplicateCompsOperation: Operation = {
  id: "kvfx.op.comp.deepDuplicateComps",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const env = ctx.env;
    const project = env.rawProject();
    if (!project) throw hostError(ErrorCode.PreconditionFailed, "Open a project first.");

    const sources: AeRawComp[] = [];
    const seen: { [id: string]: boolean } = {};
    const selection = isArray(project.selection) ? project.selection : [];
    for (let i = 0; i < selection.length; i += 1) {
      const item = selection[i];
      if (item && env.isComp(item) && !seen[String(item.id)]) {
        seen[String(item.id)] = true;
        sources[sources.length] = item as AeRawComp;
      }
    }
    let from = "project";
    if (sources.length === 0) {
      const active = env.rawComp();
      if (active) {
        sources[0] = active;
        from = "viewer";
      }
    }
    if (sources.length === 0) {
      throw hostError(ErrorCode.PreconditionFailed, "Select a comp in the Project panel, or open one.");
    }

    const copier = createDeepCopier(env);
    const created: number[] = [];
    const names: string[] = [];
    const made: { [id: string]: boolean } = {};
    for (let i = 0; i < sources.length; i += 1) {
      const copy = copier.copy(sources[i] as AeRawComp);
      // Selecting a comp and a comp nested inside it yields one copy of each,
      // not two of the inner one.
      if (made[String(copy.id)]) continue;
      made[String(copy.id)] = true;
      created[created.length] = copy.id;
      names[names.length] = copy.name;
    }

    const stats = copier.finish();
    return {
      ids: created as unknown as HostJson,
      createdNames: names as unknown as HostJson,
      from: from,
      compCount: stats.compCount,
      rewrittenExpressions: stats.rewritten,
      dynamicExpressions: stats.dynamic,
    };
  },
};

const MAX_NESTING = 32;
const MAX_PROPERTY_DEPTH = 24;

function uniqueCompName(env: OperationContext["env"], base: string): string {
  const project = env.rawProject();
  const taken: { [name: string]: boolean } = {};
  if (project) {
    for (let i = 1; i <= project.numItems; i += 1) taken[project.item(i).name] = true;
  }
  let n = 2;
  let candidate = base + " " + String(n);
  while (taken[candidate]) {
    n += 1;
    candidate = base + " " + String(n);
  }
  return candidate;
}

function escapeForQuotes(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i += 1) {
    const ch = name.charAt(i);
    out += ch === "\\" || ch === '"' ? "\\" + ch : ch;
  }
  return out;
}

/** Walks a property tree, retargeting literal `comp("Old")` references. */
function rewriteExpressions(
  group: AeRawProp | AeRawLayer,
  renamed: { from: string; to: string }[],
  leafType: number,
  depth: number,
): { rewritten: number; dynamic: number } {
  let rewritten = 0;
  let dynamic = 0;
  if (depth > MAX_PROPERTY_DEPTH) return { rewritten, dynamic };

  for (let i = 1; i <= group.numProperties; i += 1) {
    const prop = group.property(i);
    if (!prop) continue;
    if (prop.propertyType !== leafType) {
      const inner = rewriteExpressions(prop, renamed, leafType, depth + 1);
      rewritten += inner.rewritten;
      dynamic += inner.dynamic;
      continue;
    }
    if (!prop.canSetExpression || !prop.expression) continue;

    const original = prop.expression;
    let next = original;
    for (let r = 0; r < renamed.length; r += 1) {
      const pair = renamed[r] as { from: string; to: string };
      next = replaceAll(next, 'comp("' + escapeForQuotes(pair.from) + '")', 'comp("' + escapeForQuotes(pair.to) + '")');
      next = replaceAll(next, "comp('" + pair.from + "')", "comp('" + pair.to + "')");
    }
    if (next !== original) {
      prop.expression = next;
      rewritten += 1;
    } else if (/comp\s*\(\s*[^"'\s)]/.test(original)) {
      dynamic += 1;
    }
  }
  return { rewritten, dynamic };
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (needle.length === 0) return haystack;
  return haystack.split(needle).join(replacement);
}

export const layerEditOperations: Operation[] = [
  duplicateLayerOperation,
  setLayerAttributesOperation,
  selectLayersOperation,
  precomposeEachOperation,
  splitLayerOperation,
  deepDuplicateOperation,
  deepDuplicateCompsOperation,
];
