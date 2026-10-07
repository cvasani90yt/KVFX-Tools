import { USER_DATA_DIRNAME } from "@kvfx/core";
import { systemPathToNative } from "./settings-store.js";
import { CEP_FS_NO_ERROR, SYSTEM_PATH_USER_DATA } from "./types.js";

/**
 * File access for the Library and Media tabs, through `cep.fs`.
 *
 * Every path that reaches here came from the user: a folder they picked, or a
 * file they pasted or dropped that we save. Writes go only to two places — our
 * own application-data folder, or a "KVFX Media" folder beside a saved project
 * the user chose in Settings — and never replace an existing file.
 */

export interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  /** Lower-case, without the dot; empty for folders and extensionless files. */
  readonly extension: string;
}

const MAX_ENTRIES = 2000;
/** cep.fs error code when the target already exists. */
const ERR_FILE_EXISTS = 10;

function fs(): NonNullable<NonNullable<Window["cep"]>["fs"]> | undefined {
  return window.cep?.fs;
}

export function filesAvailable(): boolean {
  return fs() !== undefined && window.__adobe_cep__ !== undefined;
}

export function join(...parts: readonly string[]): string {
  return parts
    .map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((part) => part.length > 0)
    .join("/");
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** The OS folder picker. Undefined when cancelled or unavailable. */
export function pickFolder(title: string): string | undefined {
  const api = fs();
  if (api === undefined) return undefined;
  const result = api.showOpenDialog(false, true, title, "");
  if (result.err !== CEP_FS_NO_ERROR) return undefined;
  return result.data?.[0];
}

/** One level of a folder, folders first then files, both by name. */
export function listFolder(path: string): FileEntry[] | undefined {
  const api = fs();
  if (api === undefined) return undefined;
  const result = api.readdir(path);
  if (result.err !== CEP_FS_NO_ERROR || result.data === undefined) return undefined;

  const entries: FileEntry[] = [];
  for (const name of result.data.slice(0, MAX_ENTRIES)) {
    // Hidden files and macOS metadata are never what the user is looking for.
    if (name.startsWith(".")) continue;
    const full = join(path, name);
    const stat = api.stat(full);
    const isDirectory = stat.err === CEP_FS_NO_ERROR && stat.data?.isDirectory() === true;
    entries.push({ name, path: full, isDirectory, extension: isDirectory ? "" : extensionOf(name) });
  }
  return entries.sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDirectory ? -1 : 1,
  );
}

export function exists(path: string): boolean {
  const api = fs();
  return api !== undefined && api.stat(path).err === CEP_FS_NO_ERROR;
}

/** Creates a folder and any missing parents. */
export function makeDirs(path: string): boolean {
  const api = fs();
  if (api === undefined) return false;
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  let current = "";
  for (const [i, part] of parts.entries()) {
    current = i === 0 ? part : `${current}/${part}`;
    // The drive (C:) or the root ("") is never created.
    if (current.length === 0 || /^[A-Za-z]:$/.test(current)) continue;
    const result = api.makedir(current);
    if (result.err !== CEP_FS_NO_ERROR && result.err !== ERR_FILE_EXISTS && !exists(current)) return false;
  }
  return exists(normalized);
}

/**
 * A path in `folder` for `name` that does not exist yet: "logo.png", then
 * "logo 2.png", "logo 3.png"… Nothing is ever overwritten.
 */
export function freePath(folder: string, name: string): string {
  const ext = extensionOf(name);
  const stem = ext.length > 0 ? name.slice(0, name.length - ext.length - 1) : name;
  let candidate = join(folder, name);
  for (let n = 2; exists(candidate); n += 1) {
    candidate = join(folder, ext.length > 0 ? `${stem} ${String(n)}.${ext}` : `${stem} ${String(n)}`);
  }
  return candidate;
}

export function writeBase64(path: string, base64: string): boolean {
  const api = fs();
  const encoding = window.cep?.encoding?.Base64 ?? "Base64";
  if (api === undefined) return false;
  return api.writeFile(path, base64, encoding).err === CEP_FS_NO_ERROR;
}

/** KVFX's folder in the platform application-data root. */
export function appDataFolder(...sub: readonly string[]): string | undefined {
  const host = window.__adobe_cep__;
  if (host === undefined) return undefined;
  return join(systemPathToNative(host.getSystemPath(SYSTEM_PATH_USER_DATA)), USER_DATA_DIRNAME, ...sub);
}

/** A `file://` URL for showing a local image in the panel. */
export function fileUrl(path: string): string {
  const forward = path.replace(/\\/g, "/");
  const prefixed = /^[A-Za-z]:/.test(forward) ? `/${forward}` : forward;
  return `file://${encodeURI(prefixed).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}
