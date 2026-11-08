import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/**
 * Starts the operating system's own colour picker for Pick from screen — the
 * fallback for when the panel can't start it itself. The panel normally does,
 * through CEP, so After Effects isn't involved at all. Either way the picker
 * writes its answer to a file in KVFX's cache folder that the panel waits for.
 *
 * This must return at once: After Effects is frozen while a script runs.
 *
 *   Windows  { launcher }  opens screen-pick.cmd, which the panel wrote in
 *            KVFX's cache folder, as a double-click would (File.execute): it
 *            starts the picker and exits. Never system.callSystem here —
 *            After Effects waits on that until everything the command started
 *            has ended, the picker included, and froze while it was open.
 *   macOS    { out, rgb }  the system colour panel through osascript, in the
 *            background, so the shell After Effects waits on ends at once.
 *
 *   → { platform }
 *
 * The macOS command line is built here from fixed text and the checked path,
 * and on Windows only that one file name in KVFX's cache folder is opened, so
 * this can only ever start the picker.
 */

/**
 * Only ever a file directly inside a "KVFXTools/cache" folder. The slashes in
 * [...] are escaped because ExtendScript reads regex literals by ECMAScript 3's
 * grammar, where an unescaped "/" ends the literal even inside a class.
 */
const RESULT_FILE = /[\\\/]KVFXTools[\\\/]cache[\\\/][^\\\/]+\.txt$/i;
const LAUNCHER_FILE = /[\\\/]KVFXTools[\\\/]cache[\\\/]screen-pick\.cmd$/i;
/** Line breaks, or a NUL, would break a path out of its quoting. */
const LINE_BREAK = /[\r\n]/;
const NUL = String.fromCharCode(0);
const CHANNELS = 3;
const CHANNEL_16 = 65535;
const ALLOW =
  "Turn on Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network, then try again.";

function readRgb(raw: HostJson | undefined): number[] {
  const out = [1, 1, 1];
  if (!isArray(raw)) return out;
  const list = raw as HostJson[];
  for (let i = 0; i < CHANNELS; i += 1) {
    const v = list[i];
    if (typeof v === "number" && v >= 0 && v <= 1) out[i] = v;
  }
  return out;
}

function checkedPath(raw: HostJson | undefined, pattern: RegExp, message: string): string {
  if (typeof raw !== "string" || !pattern.test(raw) || LINE_BREAK.test(raw) || raw.indexOf(NUL) !== -1) {
    throw hostError(ErrorCode.InvalidArgument, message);
  }
  return raw;
}

function shQuote(text: string): string {
  return "'" + text.split("'").join("'\\''") + "'";
}

/** The macOS picker: the system colour panel, through osascript, in the background. */
export function macCommand(out: string, rgb: number[]): string {
  const part = out + ".part";
  const colour =
    "{" +
    String(Math.round((rgb[0] ?? 1) * CHANNEL_16)) +
    ", " +
    String(Math.round((rgb[1] ?? 1) * CHANNEL_16)) +
    ", " +
    String(Math.round((rgb[2] ?? 1) * CHANNEL_16)) +
    "}";
  return (
    "( osascript -e 'activate' -e 'choose color default color " +
    colour +
    "' > " +
    shQuote(part) +
    " 2>&1 ; mv -f " +
    shQuote(part) +
    " " +
    shQuote(out) +
    " ) > /dev/null 2>&1 &"
  );
}

export const screenPickOperation: Operation = {
  id: "kvfx.op.color.screenPick",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const env = ctx.env;
    if (env.os().indexOf("Windows") !== -1) {
      const launcher = checkedPath(ctx.args["launcher"], LAUNCHER_FILE, "launcher must be screen-pick.cmd in KVFX's cache folder.");
      let opened: boolean;
      try {
        opened = env.executeFile(launcher);
      } catch {
        throw hostError(ErrorCode.PreconditionFailed, "After Effects didn't let KVFX open the screen picker. " + ALLOW);
      }
      if (!opened) {
        throw hostError(ErrorCode.PreconditionFailed, "Windows couldn't start the screen picker. Use From comp instead.");
      }
      return { platform: "windows" };
    }
    const out = checkedPath(ctx.args["out"], RESULT_FILE, "out must be a .txt file in KVFX's cache folder.");
    try {
      env.callSystem(macCommand(out, readRgb(ctx.args["rgb"])));
    } catch {
      throw hostError(ErrorCode.PreconditionFailed, "After Effects didn't let KVFX open the system colour picker. " + ALLOW);
    }
    return { platform: "mac" };
  },
};
