import type { Panel } from "../app/panel.js";
import type { Session, SessionState } from "../app/session.js";
import {
  type JsonObject,
  SYSTEM_PICKER_TIMEOUT_MS,
  hexToRgb,
  macPickerScript,
  powershellCandidates,
  windowsPickerArgs,
  windowsPickerLauncher,
} from "@kvfx/core";
import { appDataFolder, exists, filesAvailable, join, makeDirs, readBase64, readText, removeCacheFile, writeCacheText } from "../app/cep/files.js";
import { processRunning, startProcess, stopProcess } from "../app/cep/process.js";
import { IconSize, createIcon } from "../components/icons.js";
import { normalizeHex } from "./color-picker.js";
import { h, setEnabled, setText } from "./dom.js";
import { fitWithin, hexAt, parsePicked, pngComplete, refusedByHost } from "./eyedropper-core.js";

/**
 * The two eyedroppers behind Tools ▸ Colour's picker.
 *
 * Pick from comp: After Effects saves the open comp's frame at the playhead
 * into KVFX's cache folder; the panel shows it, with a magnifier and a live
 * hex readout, and a click takes that pixel's colour. It works everywhere,
 * because nothing outside the panel has to be read.
 *
 * Pick from screen: anywhere on screen, other apps included. Inside After
 * Effects, whose panels have no eyedropper, through the operating system's
 * own picker, which the panel starts itself so After Effects never waits on
 * it; in a plain browser (the preview), through Chromium's eyedropper.
 */

/* eslint-disable no-magic-numbers -- timings, the magnifier's size and its zoom are the content */

/** How long to wait for After Effects to finish writing the frame after it says it's done. */
const WRITE_WAIT_MS = 8000;
const POLL_MS = 120;
const LOUPE_PIXELS = 11;
const LOUPE_SIZE = 110;
const FRAME_FILE = "comp-frame.png";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FrameInfo {
  readonly width: number;
  readonly height: number;
  readonly background: readonly number[];
  readonly bitsPerChannel: number;
}

function frameInfo(value: unknown): FrameInfo | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const background = Array.isArray(v["background"]) ? (v["background"] as unknown[]).map((n) => (typeof n === "number" ? n : 0)) : [0, 0, 0];
  return {
    width: typeof v["width"] === "number" ? v["width"] : 0,
    height: typeof v["height"] === "number" ? v["height"] : 0,
    background,
    bitsPerChannel: typeof v["bitsPerChannel"] === "number" ? v["bitsPerChannel"] : 8,
  };
}

/** Waits for a whole PNG at `path`, however After Effects paces the write. */
async function waitForPng(path: string, ms: number): Promise<string | undefined> {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (exists(path)) {
      const data = readBase64(path);
      if (data !== undefined && pngComplete(data)) return data;
    }
    await delay(POLL_MS);
  }
  return undefined;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error("The frame couldn't be read."));
    image.src = src;
  });
}

const css = (rgb: readonly number[]): string =>
  `rgb(${String(Math.round((rgb[0] ?? 0) * 255))}, ${String(Math.round((rgb[1] ?? 0) * 255))}, ${String(Math.round((rgb[2] ?? 0) * 255))})`;

/** Pick from comp: the frame in the panel, and a click takes a colour from it. */
export class CompEyedropper {
  readonly #panel: Panel;
  readonly #root: HTMLElement;
  readonly #status: HTMLElement;
  readonly #note: HTMLElement;
  readonly #stage: HTMLElement;
  readonly #view: HTMLCanvasElement;
  readonly #loupe: HTMLCanvasElement;
  readonly #chip: HTMLElement;
  readonly #hex: HTMLElement;
  readonly #where: HTMLElement;
  readonly #retry: HTMLButtonElement;
  readonly #frame: HTMLCanvasElement = document.createElement("canvas");
  #pixels: Uint8ClampedArray | undefined;
  #probe: { x: number; y: number } = { x: 0, y: 0 };
  #onPick: ((hex: string) => void) | undefined;
  #token = 0;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#status = h("p", { class: "kvfx-hint kvfx-eyedrop__status", attrs: { "aria-live": "polite" } });
    this.#note = h("p", { class: "kvfx-hint kvfx-eyedrop__note" });
    this.#note.hidden = true;
    this.#view = h("canvas", {
      class: "kvfx-eyedrop__view",
      attrs: { tabindex: "0", role: "img", "aria-label": "The comp's frame — click a spot, or use the arrow keys and Enter, to take its colour" },
    });
    this.#loupe = h("canvas", { class: "kvfx-eyedrop__loupe", attrs: { "aria-hidden": "true", width: String(LOUPE_SIZE * 2), height: String(LOUPE_SIZE * 2) } });
    this.#loupe.hidden = true;
    this.#stage = h("div", { class: "kvfx-eyedrop__stage" }, this.#view, this.#loupe);
    this.#chip = h("span", { class: "kvfx-eyedrop__chip" });
    this.#hex = h("span", { class: "kvfx-eyedrop__hex" });
    this.#where = h("span", { class: "kvfx-eyedrop__where" });
    this.#retry = h("button", { class: "kvfx-pill", type: "button", text: "Try again", on: { click: () => void this.#grab() } });
    this.#retry.hidden = true;
    const refresh = h(
      "button",
      { class: "kvfx-iconbtn", type: "button", title: "Grab the frame again — after moving the playhead, say", attrs: { "aria-label": "Grab the frame again" }, on: { click: () => void this.#grab() } },
      createIcon("refresh", IconSize.medium),
    );
    const close = h("button", { class: "kvfx-iconbtn", type: "button", title: "Close", attrs: { "aria-label": "Close" }, on: { click: () => this.close() } }, createIcon("close"));
    const dialog = h(
      "div",
      { class: "kvfx-dialog kvfx-dialog--wide kvfx-eyedrop", attrs: { role: "dialog", "aria-label": "Pick from comp" } },
      h("div", { class: "kvfx-dialog__head" }, h("h2", { class: "kvfx-dialog__title", text: "Pick from comp" }), refresh, close),
      this.#status,
      this.#note,
      this.#stage,
      h("div", { class: "kvfx-eyedrop__readout" }, this.#chip, this.#hex, this.#where),
      this.#retry,
    );
    this.#root = h("div", {
      class: "kvfx-overlay kvfx-overlay--eyedrop",
      on: {
        mousedown: (event) => {
          if (event.target === this.#root) this.close();
        },
        keydown: (event) => {
          // The panel's own shortcuts stay out of it while it is open.
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            this.close();
          }
        },
      },
    }, dialog);
    this.#root.hidden = true;

    this.#view.addEventListener("pointermove", (event) => this.#hover(event));
    this.#view.addEventListener("pointerleave", () => {
      this.#loupe.hidden = true;
    });
    this.#view.addEventListener("click", (event) => {
      this.#hover(event);
      this.#pick();
    });
    this.#view.addEventListener("keydown", (event) => this.#key(event));
    window.addEventListener("resize", () => {
      if (!this.#root.hidden) this.#layout();
    });
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  open(onPick: (hex: string) => void): void {
    if (!this.#root.isConnected) document.body.append(this.#root);
    this.#onPick = onPick;
    this.#root.hidden = false;
    void this.#grab();
  }

  close(): void {
    this.#token += 1;
    this.#root.hidden = true;
    this.#onPick = undefined;
    this.#pixels = undefined;
  }

  #say(text: string, failed = false): void {
    setText(this.#status, text);
    this.#status.classList.toggle("kvfx-eyedrop__status--error", failed);
    this.#retry.hidden = !failed;
  }

  async #grab(): Promise<void> {
    const token = (this.#token += 1);
    this.#pixels = undefined;
    this.#stage.hidden = true;
    this.#note.hidden = true;
    setText(this.#hex, "");
    setText(this.#where, "");
    this.#chip.style.backgroundColor = "transparent";
    this.#say("Grabbing the frame at the playhead…");
    const folder = appDataFolder("cache");
    if (folder === undefined || !filesAvailable()) {
      this.#say("Pick from comp works inside After Effects.", true);
      return;
    }
    if (!makeDirs(folder)) {
      this.#say("KVFX couldn't create its cache folder, so the frame can't be saved.", true);
      return;
    }
    const path = join(folder, FRAME_FILE);
    // A stale frame from last time must not pass for this one.
    removeCacheFile(path);
    const reply = await this.#panel.session.grabCompFrame(path);
    if (token !== this.#token) return;
    if (!reply.ok) {
      this.#say(reply.message, true);
      return;
    }
    const info = frameInfo(reply.value);
    const data = await waitForPng(path, WRITE_WAIT_MS);
    removeCacheFile(path);
    if (token !== this.#token) return;
    if (data === undefined || info === undefined) {
      this.#say(
        "After Effects didn't finish saving the frame. Try again — if it comes back black, click in the comp viewer first. If it keeps failing, turn on Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network.",
        true,
      );
      return;
    }
    let image: HTMLImageElement;
    try {
      image = await loadImage(`data:image/png;base64,${data}`);
    } catch {
      this.#say("The saved frame couldn't be read. Try again.", true);
      return;
    }
    if (token !== this.#token) return;
    this.#show(image, info);
  }

  /** Draws the frame over the comp's background, as the viewer shows it, and keeps its pixels to sample. */
  #show(image: HTMLImageElement, info: FrameInfo): void {
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    this.#frame.width = w;
    this.#frame.height = h;
    const g = this.#frame.getContext("2d");
    if (g === null) {
      this.#say("The frame couldn't be drawn.", true);
      return;
    }
    g.fillStyle = css(info.background);
    g.fillRect(0, 0, w, h);
    g.drawImage(image, 0, 0);
    this.#pixels = g.getImageData(0, 0, w, h).data;
    this.#probe = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    this.#say("Click anywhere on the frame to take its colour.");
    this.#note.hidden = info.bitsPerChannel !== 32;
    setText(this.#note, "This project works in 32-bit colour, where After Effects can save the frame darker than the viewer shows it — colours picked here may read dark.");
    this.#stage.hidden = false;
    this.#layout();
    this.#readout();
    this.#view.focus();
  }

  #layout(): void {
    if (this.#pixels === undefined) return;
    const ratio = window.devicePixelRatio || 1;
    const size = fitWithin(this.#frame.width, this.#frame.height, Math.max(120, this.#stage.clientWidth), Math.max(120, window.innerHeight * 0.55));
    this.#view.style.width = `${String(size.width)}px`;
    this.#view.style.height = `${String(size.height)}px`;
    this.#view.width = Math.round(size.width * ratio);
    this.#view.height = Math.round(size.height * ratio);
    const g = this.#view.getContext("2d");
    if (g === null) return;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.#frame, 0, 0, this.#view.width, this.#view.height);
  }

  /** The pointer's spot on the frame, in the frame's own pixels. */
  #hover(event: PointerEvent | MouseEvent): void {
    if (this.#pixels === undefined) return;
    const box = this.#view.getBoundingClientRect();
    const x = Math.min(this.#frame.width - 1, Math.max(0, Math.floor(((event.clientX - box.left) / Math.max(1, box.width)) * this.#frame.width)));
    const y = Math.min(this.#frame.height - 1, Math.max(0, Math.floor(((event.clientY - box.top) / Math.max(1, box.height)) * this.#frame.height)));
    this.#probe = { x, y };
    this.#readout();
    this.#magnify(event.clientX - box.left, event.clientY - box.top, box.width, box.height);
  }

  #key(event: KeyboardEvent): void {
    if (this.#pixels === undefined) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      this.#probe = {
        x: Math.min(this.#frame.width - 1, Math.max(0, this.#probe.x + move[0])),
        y: Math.min(this.#frame.height - 1, Math.max(0, this.#probe.y + move[1])),
      };
      this.#readout();
      const box = this.#view.getBoundingClientRect();
      this.#magnify(((this.#probe.x + 0.5) / this.#frame.width) * box.width, ((this.#probe.y + 0.5) / this.#frame.height) * box.height, box.width, box.height);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.#pick();
    }
  }

  #current(): string | undefined {
    return this.#pixels === undefined ? undefined : hexAt(this.#pixels, this.#frame.width, this.#probe.x, this.#probe.y);
  }

  #readout(): void {
    const hex = this.#current();
    if (hex === undefined) return;
    this.#chip.style.backgroundColor = hex;
    setText(this.#hex, hex.toUpperCase());
    setText(this.#where, `x ${String(this.#probe.x)} · y ${String(this.#probe.y)}`);
  }

  /** The magnifier: the pixels around the spot, large, beside the pointer. */
  #magnify(px: number, py: number, width: number, height: number): void {
    const g = this.#loupe.getContext("2d");
    if (g === null) return;
    const size = this.#loupe.width;
    const half = Math.floor(LOUPE_PIXELS / 2);
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    g.drawImage(this.#frame, this.#probe.x - half, this.#probe.y - half, LOUPE_PIXELS, LOUPE_PIXELS, 0, 0, size, size);
    const cell = size / LOUPE_PIXELS;
    // A faint grid, so each square reads as one pixel of the frame.
    g.strokeStyle = "rgba(0, 0, 0, 0.18)";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < LOUPE_PIXELS; i += 1) {
      g.moveTo(i * cell + 0.5, 0);
      g.lineTo(i * cell + 0.5, size);
      g.moveTo(0, i * cell + 0.5);
      g.lineTo(size, i * cell + 0.5);
    }
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = "#000";
    g.strokeRect(half * cell, half * cell, cell, cell);
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    g.strokeRect(half * cell + 1.5, half * cell + 1.5, cell - 3, cell - 3);
    // Beside the pointer, flipped near the right and bottom edges so it stays in view.
    const gap = 14;
    const left = px + gap + LOUPE_SIZE > width ? px - gap - LOUPE_SIZE : px + gap;
    const top = py + gap + LOUPE_SIZE > height ? py - gap - LOUPE_SIZE : py + gap;
    this.#loupe.style.left = `${String(Math.max(0, left))}px`;
    this.#loupe.style.top = `${String(Math.max(0, top))}px`;
    this.#loupe.hidden = false;
  }

  #pick(): void {
    const hex = this.#current();
    const done = this.#onPick;
    if (hex === undefined || done === undefined) return;
    this.close();
    done(hex);
  }
}

// ---------------------------------------------------------------------------
// Pick from screen
// ---------------------------------------------------------------------------

interface EyeDropperLike {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

type EyeDropperConstructor = new () => EyeDropperLike;

function eyeDropper(): EyeDropperConstructor | undefined {
  const value = (window as unknown as { EyeDropper?: unknown }).EyeDropper;
  return typeof value === "function" ? (value as EyeDropperConstructor) : undefined;
}

/** Whether this panel's browser engine has an eyedropper at all. Whether the host app allows it is only known by trying. */
export function screenPickerExists(): boolean {
  return eyeDropper() !== undefined;
}

export type ScreenPick = { readonly hex: string } | "cancelled" | "unsupported";

let pending: AbortController | undefined;

/** Whether the system eyedropper is open now. */
export function screenPickOpen(): boolean {
  return pending !== undefined;
}

/** Closes the system eyedropper, if it is open. */
export function cancelScreenPick(): void {
  pending?.abort();
}

/**
 * Opens the system eyedropper; call it straight from a click, which it needs.
 * A refusal that comes back at once means the host app hasn't built the
 * screen picker — "unsupported" — while a person pressing Escape is "cancelled".
 */
export async function pickFromScreen(): Promise<ScreenPick> {
  const Picker = eyeDropper();
  if (Picker === undefined) return "unsupported";
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const started = performance.now();
  try {
    const result = await new Picker().open({ signal: controller.signal });
    const hex = normalizeHex(result.sRGBHex);
    return hex === undefined ? "cancelled" : { hex };
  } catch {
    return !controller.signal.aborted && refusedByHost(performance.now() - started) ? "unsupported" : "cancelled";
  } finally {
    if (pending === controller) pending = undefined;
  }
}

// ---------------------------------------------------------------------------
// The buttons, shared by Tools ▸ Colour and the Quick tab
// ---------------------------------------------------------------------------

/** How long the panel waits for the system picker: the picker's own time limit, and time to start. */
const NATIVE_WAIT_MS = SYSTEM_PICKER_TIMEOUT_MS + 20_000;
const NATIVE_POLL_MS = 250;
const SCREEN_FILE = "screen-pick.txt";
const LAUNCHER_FILE = "screen-pick.cmd";

const onWindows = (): boolean => /^win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent);

/** The system picker the panel started, so a second click or the time limit can close it. */
let pickerPid: number | undefined;

function stopPicker(): void {
  if (pickerPid !== undefined) stopProcess(pickerPid);
  pickerPid = undefined;
}

/** What waiting on the system picker came to. */
type Answer = { readonly text: string } | "ended" | "cancelled" | "timeout";

/**
 * Waits for the system picker's answer. It writes a whole file in one move, so
 * any file is the answer — and a picker that has ended without one won't.
 */
async function waitForAnswer(path: string, cancelled: () => boolean, pid: number | undefined): Promise<Answer> {
  const deadline = performance.now() + NATIVE_WAIT_MS;
  const read = (): Answer | undefined => {
    const text = exists(path) ? readText(path) : undefined;
    return text === undefined ? undefined : { text };
  };
  for (;;) {
    const answer = read();
    if (answer !== undefined) return answer;
    if (cancelled()) return "cancelled";
    if (performance.now() > deadline) return "timeout";
    if (pid !== undefined && processRunning(pid) === false) {
      // The answer and the exit can cross: one last look.
      await delay(NATIVE_POLL_MS);
      return read() ?? "ended";
    }
    await delay(NATIVE_POLL_MS);
  }
}

let sharedComp: CompEyedropper | undefined;

/**
 * "From comp" and "From screen" buttons wherever they appear: a picked colour
 * becomes the panel's colour, and From comp is off without a comp.
 *
 * Inside After Effects, whose panels have no eyedropper, From screen opens the
 * operating system's own picker — a click-to-pick copy of the screens on
 * Windows, the colour panel on macOS — started so that After Effects never
 * waits on it. Outside After Effects (the preview) the browser's eyedropper
 * does it, and the button shows only if it exists.
 */
export class Eyedroppers {
  readonly #panel: Panel;
  readonly #comp: HTMLButtonElement[] = [];
  readonly #screen: HTMLButtonElement[] = [];

  constructor(panel: Panel) {
    this.#panel = panel;
  }

  /** Wires a button to Pick from comp. */
  comp(button: HTMLButtonElement): HTMLButtonElement {
    button.addEventListener("click", () => {
      sharedComp ??= new CompEyedropper(this.#panel);
      sharedComp.open((hex) => this.#take(hex, "comp"));
    });
    this.#comp.push(button);
    return button;
  }

  /** Wires a button to Pick from screen; `idle` is its label when not picking. */
  screen(button: HTMLButtonElement, idle: string): HTMLButtonElement {
    // No await before pickFromScreen: the browser's eyedropper only opens straight from a click.
    button.addEventListener("click", () => void pickScreen(this.#panel, button, idle, (hex) => this.#take(hex, "screen")));
    this.#screen.push(button);
    return button;
  }

  update(state: SessionState): void {
    const connected = state.connection.status === "connected";
    for (const button of this.#comp) {
      setEnabled(button, connected && state.snapshot.comp !== undefined, connected ? "Open a composition first." : "Not connected to After Effects.", "Pick a colour from the comp's frame at the playhead");
    }
    const insideAe = filesAvailable();
    for (const button of this.#screen) {
      button.hidden = !insideAe && !screenPickerExists();
      setEnabled(button, !insideAe || connected, "Not connected to After Effects.", "Pick a colour from anywhere on your screen. Click again to cancel.");
    }
  }

  #take(hex: string, from: string): void {
    const session = this.#panel.session;
    session.setUi("solidColor", hex);
    session.report("Colour", true, `Picked ${hex.toUpperCase()} from the ${from}`);
  }
}

/** One pick at a time across every From screen button; a second click on any of them cancels it. */
let screenPick: { token: number; busy: boolean } = { token: 0, busy: false };

async function pickScreen(panel: Panel, button: HTMLButtonElement, idle: string, take: (hex: string) => void): Promise<void> {
  if (screenPick.busy) {
    // A second click cancels, and closes the picker too when the panel started it.
    cancelScreenPick();
    stopPicker();
    screenPick = { token: screenPick.token + 1, busy: false };
    return;
  }
  const session = panel.session;
  const label = button.querySelector("span");
  const busy = (on: boolean): void => {
    button.classList.toggle("kvfx-pill--busy", on);
    if (label !== null) setText(label, on ? "Picking…" : idle);
  };
  const token = screenPick.token + 1;
  screenPick = { token, busy: true };
  const current = (): boolean => screenPick.token === token;
  try {
    if (!filesAvailable()) {
      // Outside After Effects only the browser's eyedropper can work. It is
      // opened before anything else happens: it needs the click it came from.
      const picking = pickFromScreen();
      busy(true);
      const result = await picking;
      if (!current()) return;
      if (typeof result === "object") take(result.hex);
      else if (result === "unsupported") session.report("Pick from screen", false, "Picking from the screen works inside After Effects.");
      return;
    }
    busy(true);
    const hex = await pickWithSystem(panel, current);
    if (hex !== undefined && current()) take(hex);
  } finally {
    if (current()) {
      screenPick = { token, busy: false };
      busy(false);
    } else if (!screenPick.busy) {
      busy(false);
    }
  }
}

/**
 * The operating system's own colour picker; the answer comes back as a file
 * in KVFX's cache folder. The panel starts it as its own process, so After
 * Effects isn't involved and can't be held up, and a second click or the time
 * limit can close it.
 */
async function pickWithSystem(panel: Panel, current: () => boolean): Promise<string | undefined> {
  const session = panel.session;
  const fail = (message: string): undefined => {
    session.report("Pick from screen", false, message);
    return undefined;
  };
  const folder = appDataFolder("cache");
  if (folder === undefined || !makeDirs(folder)) return fail("KVFX couldn't create its cache folder, so the screen picker can't answer.");
  const out = join(folder, SCREEN_FILE);
  removeCacheFile(out);
  removeCacheFile(`${out}.part`);
  const rgb = hexToRgb(session.state.settings.ui.solidColor) ?? [1, 1, 1];

  if (!(await startPicker(session, folder, out, rgb))) return undefined;
  const pid = pickerPid;
  const answer = await waitForAnswer(out, () => !current(), pid);
  // A picker that answered has ended by itself; one still open after a cancel
  // or the time limit is closed here.
  if (pickerPid === pid) {
    if (typeof answer !== "object") stopPicker();
    pickerPid = undefined;
  }
  removeCacheFile(out);
  if (answer === "cancelled" || !current()) return undefined;
  if (answer === "timeout") return fail("The screen picker didn't answer in time, so it was closed. Try again, or use From comp.");
  if (answer === "ended") return fail("The screen picker closed without a colour. If it never appeared, security software may have stopped it — use From comp instead.");
  const picked = parsePicked(answer.text);
  if (picked === "cancelled") return undefined;
  if (picked === undefined) return fail("The screen picker couldn't open on this computer. Use From comp instead.");
  return picked.hex;
}

/**
 * Starts the picker from the panel when CEP allows it. Otherwise After
 * Effects starts it in a way that returns at once: on Windows by opening a
 * launcher file as a double-click would, never by running a command — After
 * Effects waits on a command, and on everything it starts.
 */
async function startPicker(session: Session, folder: string, out: string, rgb: readonly number[]): Promise<boolean> {
  if (!onWindows()) {
    pickerPid = startProcess("/bin/sh", ["-c", macPickerScript(out, rgb)]);
    return pickerPid !== undefined || launchThroughHost(session, { out, rgb: [rgb[0] ?? 1, rgb[1] ?? 1, rgb[2] ?? 1] });
  }
  const powershell = powershellCandidates(appDataFolder() ?? "").find((path) => exists(path));
  if (powershell === undefined) {
    session.report("Pick from screen", false, "Windows PowerShell, which shows the screen picker, wasn't found. Use From comp instead.");
    return false;
  }
  pickerPid = startProcess(powershell, windowsPickerArgs(out));
  if (pickerPid !== undefined) return true;
  const launcher = join(folder, LAUNCHER_FILE);
  removeCacheFile(launcher);
  if (!writeCacheText(launcher, windowsPickerLauncher(powershell, out))) {
    session.report("Pick from screen", false, "KVFX couldn't prepare the screen picker in its cache folder.");
    return false;
  }
  return launchThroughHost(session, { launcher });
}

async function launchThroughHost(session: Session, args: JsonObject): Promise<boolean> {
  const reply = await session.query("kvfx.op.color.screenPick", args);
  // A late reply isn't a refusal: the answer file still decides.
  if (reply.ok || /budget|took/i.test(reply.message)) return true;
  session.report("Pick from screen", false, reply.message);
  return false;
}
