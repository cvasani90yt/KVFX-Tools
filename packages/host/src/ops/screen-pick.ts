import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/**
 * Opens the operating system's own colour picker, for Pick from screen where
 * the panel's browser eyedropper isn't available. It runs on its own — After
 * Effects is not held while the user picks — and writes the colour to `out`,
 * a file in KVFX's cache folder that the panel waits for:
 *
 *   macOS    the system colour panel, whose magnifier picks any pixel on any
 *            screen. Writes "R, G, B" in 16-bit, or a -128 error if cancelled.
 *   Windows  a frozen copy of every screen, shown full-screen: click a pixel,
 *            or Esc to cancel. Writes "#rrggbb" or "cancel". The picker is sent
 *            as an encoded command, so no script file has to be allowed to run.
 *
 *   { out, rgb: [r, g, b] }  →  { platform }
 *
 * The command lines are built here from fixed text and the checked path, never
 * from text the panel sends, so this can only ever open the picker.
 */

/**
 * Only ever a .txt directly inside a "KVFXTools/cache" folder. The slashes in
 * [...] are escaped because ExtendScript reads regex literals by ECMAScript 3's
 * grammar, where an unescaped "/" ends the literal even inside a class.
 */
const RESULT_FILE = /[\\\/]KVFXTools[\\\/]cache[\\\/][^\\\/]+\.txt$/i;
/** Line breaks, or a NUL, would break a path out of its quoting. */
const LINE_BREAK = /[\r\n]/;
const NUL = String.fromCharCode(0);
const CHANNELS = 3;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CHANNEL_16 = 65535;

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

/* eslint-disable no-magic-numbers -- UTF-16 and Base64 arithmetic */
/** UTF-16LE, then Base64: what PowerShell's -EncodedCommand reads. */
export function encodePowerShell(text: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[bytes.length] = code % 256;
    bytes[bytes.length] = Math.floor(code / 256) % 256;
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : -1;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : -1;
    const n = a * 65536 + (b < 0 ? 0 : b) * 256 + (c < 0 ? 0 : c);
    out += BASE64.charAt(Math.floor(n / 262144) % 64);
    out += BASE64.charAt(Math.floor(n / 4096) % 64);
    out += b < 0 ? "=" : BASE64.charAt(Math.floor(n / 64) % 64);
    out += c < 0 ? "=" : BASE64.charAt(n % 64);
  }
  return out;
}

/* eslint-enable no-magic-numbers */

/** The Windows picker: screens frozen into a full-screen window, click to pick. */
export function windowsPicker(out: string): string {
  const quoted = "'" + out.split("'").join("''") + "'";
  return [
    "$o=" + quoted + ";$p=$o+'.part';$global:r='cancel'",
    "try{",
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "Add-Type -Namespace KvfxPick -Name Dpi -MemberDefinition '[DllImport(\"user32.dll\")]public static extern bool SetProcessDPIAware();'",
    "[void][KvfxPick.Dpi]::SetProcessDPIAware()",
    "$global:b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$global:m=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
    "$g=[System.Drawing.Graphics]::FromImage($m);$g.CopyFromScreen($b.Left,$b.Top,0,0,$m.Size);$g.Dispose()",
    "$global:f=New-Object System.Windows.Forms.Form",
    "$f.FormBorderStyle='None';$f.StartPosition='Manual';$f.Bounds=$b;$f.TopMost=$true;$f.ShowInTaskbar=$false;$f.KeyPreview=$true",
    "$f.BackgroundImage=$m;$f.Cursor=[System.Windows.Forms.Cursors]::Cross",
    "$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$l=New-Object System.Windows.Forms.Label;$l.Text='Click a colour to pick it  -  Esc to cancel';$l.AutoSize=$true",
    "$l.Padding=New-Object System.Windows.Forms.Padding 8;$l.BackColor=[System.Drawing.Color]::FromArgb(30,32,38);$l.ForeColor=[System.Drawing.Color]::White",
    "$l.Location=New-Object System.Drawing.Point(($s.Left-$b.Left+24),($s.Top-$b.Top+24));$f.Controls.Add($l)",
    "$f.Add_MouseDown({param($x,$e)if($e.Button -eq 'Left'){$c=$global:m.GetPixel($e.X,$e.Y);$global:r=('#{0:x2}{1:x2}{2:x2}' -f $c.R,$c.G,$c.B)};$global:f.Close()})",
    "$f.Add_KeyDown({param($x,$e)if($e.KeyCode -eq 'Escape'){$global:f.Close()}})",
    "$f.Add_Shown({$global:f.Activate()})",
    "[void]$f.ShowDialog()",
    "}catch{$global:r='error: '+$_.Exception.Message}",
    "[IO.File]::WriteAllText($p,$global:r);Move-Item -LiteralPath $p -Destination $o -Force",
  ].join("\n");
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

export function windowsCommand(out: string): string {
  return (
    'cmd.exe /c start "" powershell.exe -NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ' +
    encodePowerShell(windowsPicker(out))
  );
}

export const screenPickOperation: Operation = {
  id: "kvfx.op.color.screenPick",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const out = ctx.args["out"];
    if (typeof out !== "string" || !RESULT_FILE.test(out) || LINE_BREAK.test(out) || out.indexOf(NUL) !== -1) {
      throw hostError(ErrorCode.InvalidArgument, "out must be a .txt file in KVFX's cache folder.");
    }
    const rgb = readRgb(ctx.args["rgb"]);
    const windows = ctx.env.os().indexOf("Windows") !== -1;
    try {
      ctx.env.callSystem(windows ? windowsCommand(out) : macCommand(out, rgb));
    } catch {
      throw hostError(
        ErrorCode.PreconditionFailed,
        "After Effects didn't let KVFX open the system colour picker. Turn on Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network, then try again.",
      );
    }
    return { platform: windows ? "windows" : "mac" };
  },
};
