/**
 * The operating system's own colour pickers, for Pick from screen inside After
 * Effects, whose panels have no browser eyedropper.
 *
 * Only text lives here. The panel starts the picker as its own process, so
 * After Effects is never left waiting on it: a command After Effects runs
 * holds After Effects until the command lets go, and on Windows a picker
 * started that way kept After Effects frozen for as long as it was open.
 *
 *   Windows  a frozen copy of every screen, full-screen: click a pixel, or
 *            press Esc. Writes "#rrggbb", "cancel" or "error: …".
 *   macOS    the system colour panel, whose magnifier picks any pixel on any
 *            screen. Writes "R, G, B" in 16-bit, or osascript's -128 error.
 *
 * Both write `out` + ".part" and then move it into place, so whoever waits on
 * `out` never reads half an answer.
 */

/** The Windows picker closes itself after this long, if nobody has picked. */
export const SYSTEM_PICKER_TIMEOUT_MS = 180_000;

/* eslint-disable no-magic-numbers -- UTF-16 and Base64 arithmetic, and 16-bit colour */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-16LE, then Base64: what PowerShell's -EncodedCommand reads. */
export function encodePowerShell(text: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes.push(code & 0xff, code >> 8);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63);
    out += b === undefined ? "=" : BASE64.charAt((n >> 6) & 63);
    out += c === undefined ? "=" : BASE64.charAt(n & 63);
  }
  return out;
}

const channel16 = (value: number | undefined): number => Math.round(Math.min(1, Math.max(0, value ?? 1)) * 65535);

/* eslint-enable no-magic-numbers */

/**
 * The Windows picker, as a PowerShell script: every screen frozen into one
 * borderless, topmost window; a click reads the pixel under it, Esc or the
 * timeout closes it.
 */
export function windowsPickerScript(out: string): string {
  const quoted = `'${out.split("'").join("''")}'`;
  return [
    `$o=${quoted};$p=$o+'.part';$global:r='cancel'`,
    "try{",
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    // Physical pixels on a scaled display, so the click reads the pixel under it.
    // Without it the picker still works on an unscaled one.
    "try{Add-Type -Namespace KvfxPick -Name Dpi -MemberDefinition '[DllImport(\"user32.dll\")]public static extern bool SetProcessDPIAware();';[void][KvfxPick.Dpi]::SetProcessDPIAware()}catch{}",
    // Whoever started this may have asked for its windows hidden, and Windows
    // applies that to the first window shown: let it be a throwaway one.
    "$d=New-Object System.Windows.Forms.Form;$d.ShowInTaskbar=$false;$d.Opacity=0;$d.FormBorderStyle='None';$d.StartPosition='Manual';$d.Location=New-Object System.Drawing.Point(-32000,-32000);$d.Show();$d.Close()",
    "$global:b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$global:m=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
    "$g=[System.Drawing.Graphics]::FromImage($m);$g.CopyFromScreen($b.Left,$b.Top,0,0,$m.Size);$g.Dispose()",
    "$global:f=New-Object System.Windows.Forms.Form",
    "$f.FormBorderStyle='None';$f.StartPosition='Manual';$f.Bounds=$b;$f.TopMost=$true;$f.ShowInTaskbar=$false;$f.KeyPreview=$true",
    "$f.BackgroundImage=$m;$f.BackgroundImageLayout='None';$f.Cursor=[System.Windows.Forms.Cursors]::Cross",
    "$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$l=New-Object System.Windows.Forms.Label;$l.Text='Click a colour to pick it  -  Esc to cancel';$l.AutoSize=$true",
    "$l.Padding=New-Object System.Windows.Forms.Padding 8;$l.BackColor=[System.Drawing.Color]::FromArgb(30,32,38);$l.ForeColor=[System.Drawing.Color]::White",
    "$l.Location=New-Object System.Drawing.Point(($s.Left-$b.Left+24),($s.Top-$b.Top+24));$f.Controls.Add($l)",
    "$f.Add_MouseDown({param($x,$e)if($e.Button -eq 'Left'){$c=$global:m.GetPixel($e.X,$e.Y);$global:r=('#{0:x2}{1:x2}{2:x2}' -f $c.R,$c.G,$c.B)};$global:f.Close()})",
    "$f.Add_KeyDown({param($x,$e)if($e.KeyCode -eq 'Escape'){$global:f.Close()}})",
    `$global:t=New-Object System.Windows.Forms.Timer;$t.Interval=${String(SYSTEM_PICKER_TIMEOUT_MS)};$t.Add_Tick({$global:t.Stop();$global:f.Close()});$t.Start()`,
    "$f.Add_Shown({$global:f.Activate();[void]$global:f.Focus()})",
    "[void]$f.ShowDialog()",
    "}catch{$global:r='error: '+$_.Exception.Message}",
    "[IO.File]::WriteAllText($p,$global:r);Move-Item -LiteralPath $p -Destination $o -Force",
  ].join("\n");
}

/**
 * powershell.exe's arguments for the picker. None contains a space or a
 * quote, so they survive however the launcher joins them into a command line.
 */
export function windowsPickerArgs(out: string): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-Sta",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
    encodePowerShell(windowsPickerScript(out)),
  ];
}

/**
 * A .cmd file that starts the picker and exits, for After Effects to open the
 * way a double-click would when the panel can't start processes itself.
 * Opening a file returns at once; running a command waits for it.
 */
export function windowsPickerLauncher(powershell: string, out: string): string {
  return `@start "" "${powershell}" ${windowsPickerArgs(out).join(" ")}\r\n`;
}

const POWERSHELL_UNDER_ROOT = "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

/**
 * Where powershell.exe can be, most likely first: under Windows on the drive
 * that holds the user's folders (`userData`, any separators), then on C:.
 */
export function powershellCandidates(userData: string): string[] {
  const drive = /^([A-Za-z]:)/.exec(userData)?.[1]?.toUpperCase();
  const roots = drive === undefined || drive === "C:" ? ["C:"] : [drive, "C:"];
  return roots.map((root) => `${root}\\Windows${POWERSHELL_UNDER_ROOT}`);
}

const shQuote = (text: string): string => `'${text.split("'").join(`'\\''`)}'`;

/**
 * The macOS picker as a /bin/sh script: the system colour panel, starting on
 * `rgb` (0–1 channels), its answer or its cancellation written to `out`.
 */
export function macPickerScript(out: string, rgb: readonly number[]): string {
  const colour = `{${String(channel16(rgb[0]))}, ${String(channel16(rgb[1]))}, ${String(channel16(rgb[2]))}}`;
  const part = shQuote(`${out}.part`);
  return `/usr/bin/osascript -e 'activate' -e 'choose color default color ${colour}' > ${part} 2>&1; /bin/mv -f ${part} ${shQuote(out)}`;
}
