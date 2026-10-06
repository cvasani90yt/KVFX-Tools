import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/**
 * Project-wide font replacement, built on `Project.usedFonts` and
 * `Project.replaceFont` (After Effects 24.5+).
 *
 * Fonts are named by PostScript name, the only identifier that is both unique
 * and the same on every machine.
 */

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;

function requireFontApi(ctx: OperationContext): { project: AeRawProject; fonts: AeFontsObject } {
  const project = ctx.env.rawProject();
  const fonts = ctx.env.fonts();
  if (!project) throw hostError(ErrorCode.PreconditionFailed, "Open a project first.");
  if (!fonts || typeof project.replaceFont !== "function" || !isArray(project.usedFonts)) {
    throw hostError(ErrorCode.UnsupportedHostVersion, "Font replacement needs After Effects 24.5 or later.");
  }
  return { project: project, fonts: fonts };
}

function describe(font: AeFont): { [key: string]: HostJson } {
  return {
    postScriptName: font.postScriptName,
    family: font.familyName,
    style: font.styleName,
  };
}

export const usedFontsOperation: Operation = {
  id: "kvfx.op.fonts.used",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const api = requireFontApi(ctx);
    const used = api.project.usedFonts as AeUsedFont[];
    const out: HostJson[] = [];
    for (let i = 0; i < used.length; i += 1) {
      const entry = used[i] as AeUsedFont;
      const record = describe(entry.font);
      record["uses"] = isArray(entry.usedAt) ? (entry.usedAt as unknown[]).length : 0;
      out[out.length] = record;
    }
    return { fonts: out as unknown as HostJson };
  },
};

/** Installed fonts whose family, style or PostScript name contains the query. */
export const searchFontsOperation: Operation = {
  id: "kvfx.op.fonts.search",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const api = requireFontApi(ctx);
    const query = typeof ctx.args["query"] === "string" ? (ctx.args["query"]).toLowerCase() : "";
    const rawLimit = ctx.args["limit"];
    const limit =
      typeof rawLimit === "number" && rawLimit > 0 ? (rawLimit > MAX_LIMIT ? MAX_LIMIT : rawLimit) : DEFAULT_LIMIT;

    const out: HostJson[] = [];
    const families = api.fonts.allFonts;
    for (let f = 0; f < families.length && out.length < limit; f += 1) {
      const family = families[f] as AeFont[];
      for (let s = 0; s < family.length && out.length < limit; s += 1) {
        const font = family[s] as AeFont;
        const haystack = (font.familyName + " " + font.styleName + " " + font.postScriptName).toLowerCase();
        if (query.length === 0 || haystack.indexOf(query) !== -1) out[out.length] = describe(font);
      }
    }
    return { fonts: out as unknown as HostJson };
  },
};

export const replaceFontOperation: Operation = {
  id: "kvfx.op.fonts.replace",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const api = requireFontApi(ctx);
    const from = ctx.args["from"];
    const to = ctx.args["to"];
    if (typeof from !== "string" || typeof to !== "string") {
      throw hostError(ErrorCode.InvalidArgument, "from and to must be PostScript names.");
    }

    let fromFont: AeFont | undefined;
    const used = api.project.usedFonts as AeUsedFont[];
    for (let i = 0; i < used.length; i += 1) {
      if ((used[i] as AeUsedFont).font.postScriptName === from) fromFont = (used[i] as AeUsedFont).font;
    }
    if (!fromFont) throw hostError(ErrorCode.TargetNotFound, from + " is no longer used in this project.");

    const candidates = api.fonts.getFontsByPostScriptName(to);
    if (!candidates || candidates.length === 0) throw hostError(ErrorCode.TargetNotFound, to + " is not installed.");

    const replaced = (api.project.replaceFont as NonNullable<AeRawProject["replaceFont"]>)(
      fromFont,
      candidates[0] as AeFont,
    );
    return { replaced: replaced === true };
  },
};

export const fontOperations: Operation[] = [usedFontsOperation, searchFontsOperation, replaceFontOperation];
