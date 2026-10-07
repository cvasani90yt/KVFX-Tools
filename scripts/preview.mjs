import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname } from "node:path";
import { join } from "node:path";
import { repoRoot, stagedExtensionDir } from "./paths.mjs";

/**
 * Renders the built panel to PNGs without After Effects.
 *
 * The panel only ever shows its real UI when a host answers, so there was no
 * way to look at it outside After Effects — which meant designing it blind.
 * This stubs `__adobe_cep__` with canned replies and screenshots the result at
 * the dock widths the manifest allows, so layout and density can be checked on
 * every change instead of once per install.
 *
 * It renders the *built* bundle, not the sources, so what is captured is what
 * ships.
 *
 * Usage: node scripts/preview.mjs [--tab tools|ease|…] [--all] [--open palette|settings] [--width 300,420]
 */

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const widths = flag("width", "300,420")
  .split(",")
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isFinite(value) && value > 0);

const CHROMIUM = process.env["KVFX_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const PANEL_HEIGHT = Number.parseInt(flag("height", "860"), 10) || 860;
const outDir = join(repoRoot, "build", "preview");
const workDir = join(outDir, "work");

/**
 * Canned host replies.
 *
 * Shaped to exercise the interesting cases rather than the happy path: a mixed
 * selection (text, footage, a parented layer, a 3D layer), an animated
 * opacity for the inspector's keyframe marker, effects for the manager, and a
 * small library on disk.
 */
const STUB = `
(function () {
  var LAYERS = [
    { id: 11, name: "Title", index: 1, kind: "text", label: 11, position: { x: 420, y: 300 }, parentId: null, threeD: false },
    { id: 12, name: "Card BG", index: 2, kind: "av", label: 8, position: { x: 900, y: 520 }, parentId: 14, threeD: false },
    { id: 13, name: "Logo 3D", index: 3, kind: "precomp", label: 9, position: { x: 1500, y: 240 }, parentId: null, threeD: true }
  ];
  function layerEntry(l) {
    return {
      id: l.id, name: l.name, index: l.index, kind: l.kind, label: l.label,
      enabled: true, locked: false, shy: false, isAV: true,
      solo: l.id === 11, threeD: l.threeD, guide: false, adjustment: false,
      inPoint: 0, outPoint: 8, startTime: 0, parentId: l.parentId
    };
  }
  function measureEntry(l) {
    return {
      id: l.id, name: l.name,
      sourceRect: { left: 0, top: 0, width: 320, height: 90 },
      anchorPoint: { x: 0, y: 0 }, position: l.position,
      scale: { x: 100, y: 100 }, rotation: 0,
      threeD: l.threeD, isAV: true, parentId: l.parentId
    };
  }
  var REPLIES = {
    "kvfx.op.system.ping": {
      hostBundleVersion: "0.1.0-dev", aeVersion: "26.0.1x45",
      aeBuild: "Adobe After Effects 26.0.1x45", aeLanguage: "en_US",
      os: "Preview", engineVersion: "4.2.0", hostTimeMs: 0
    },
    "kvfx.op.system.memory": { bytes: 15.8 * 1073741824 },
    "kvfx.op.selection.snapshot": {
      capturedAtMs: 0, hasProject: true,
      comp: { id: 1, name: "MAIN_COMP", width: 1920, height: 1080, frameRate: 25, frameDuration: 0.04,
              duration: 10, time: 1.2, workAreaStart: 0, workAreaDuration: 10, layerCount: 24 },
      layers: LAYERS.map(layerEntry),
      primary: {
        id: 11,
        anchor: { value: [160, 45, 0], animated: false, expression: false },
        position: { value: [960, 540, 0], animated: false, expression: false },
        positionSeparated: false,
        scale: { value: [100, 100, 100], animated: false, expression: false },
        rotation: { value: [0], animated: false, expression: true },
        opacity: { value: [100], animated: true, expression: false }
      }
    },
    "kvfx.op.layer.measure": {
      comp: { id: 1, width: 1920, height: 1080, time: 0 },
      layers: LAYERS.map(measureEntry),
      selectedIds: LAYERS.map(function (l) { return l.id; })
    },
    "kvfx.op.fx.list": {
      truncated: false,
      layers: [
        { id: 11, name: "Title", locked: false, effects: [
          { index: 1, name: "Glow", matchName: "ADBE Glo2", enabled: true },
          { index: 2, name: "Drop Shadow", matchName: "ADBE Drop Shadow", enabled: false },
          { index: 3, name: "KVFX Gradient Lock", matchName: "ADBE Ramp", enabled: true }
        ] },
        { id: 12, name: "Card BG", locked: true, effects: [
          { index: 1, name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", enabled: true }
        ] }
      ]
    },
    "kvfx.op.fonts.used": { fonts: [
      { postScriptName: "Inter-Bold", family: "Inter", style: "Bold", uses: 6 },
      { postScriptName: "ArialMT", family: "Arial", style: "Regular", uses: 2 }
    ] },
    "kvfx.op.fonts.search": { fonts: [] },
    "kvfx.op.keys.readEase": { property: "Opacity", bezier: [0.16, 1, 0.3, 1], linear: false },
    "kvfx.op.text.read": { id: 11, name: "Title", text: "Your title" },
    "kvfx.op.project.info": { open: true, saved: true, folder: "/projects/promo" }
  };
  window.__adobe_cep__ = {
    getExtensionId: function () { return "com.kvfx.tools.panel"; },
    getHostEnvironment: function () { return '{"appName":"AEFT","appVersion":"26.0"}'; },
    getSystemPath: function () { return "file:///preview"; },
    evalScript: function (source, callback) {
      var match = /"op":"([^"]+)"/.exec(source);
      var id = /"id":"([^"]+)"/.exec(source);
      var op = match ? match[1] : "";
      var result = REPLIES[op] === undefined ? { stepCount: 1, steps: [] } : REPLIES[op];
      setTimeout(function () {
        callback(JSON.stringify({ v: 1, id: id ? id[1] : "r1", ok: true, result: result, elapsedMs: 7 }));
      }, 0);
    }
  };
  // A read-only cep.fs with a small fake library, so every tab can be previewed.
  var DIRS = {
    "/Library/Motion": ["Lower Thirds", "Transitions", "Logo Reveal.aep", "Pop In.ffx", "Whoosh.wav", "Light Leak.mov", "Grain.mov"],
    "/Library/Motion/Lower Thirds": ["Clean.aep", "Bold.aep"]
  };
  function isDir(path) { return DIRS[path] !== undefined; }
  window.cep = {
    encoding: { UTF8: "UTF-8", Base64: "Base64" },
    fs: {
      readFile: function () { return { err: 0, data: JSON.stringify(__KVFX_SEED__) }; },
      writeFile: function () { return { err: 0 }; },
      makedir: function () { return { err: 0 }; },
      readdir: function (path) { return DIRS[path] ? { err: 0, data: DIRS[path] } : { err: 3 }; },
      stat: function (path) {
        return { err: 0, data: { isDirectory: function () { return isDir(path); }, isFile: function () { return !isDir(path); } } };
      },
      showOpenDialog: function () { return { err: 0, data: ["/Library/Motion"] }; }
    }
  };
  var OPEN = __KVFX_OPEN__;
  if (OPEN) {
    window.addEventListener("load", function () {
      setTimeout(function () {
        if (OPEN === "palette") document.querySelector('[aria-label="Search commands"]').click();
        if (OPEN === "settings") document.querySelector('[aria-label="Settings"]').click();
        if (OPEN === "library") {
          var chip = document.querySelector(".kvfx-chip__main");
          if (chip) chip.click();
        }
        if (OPEN === "fx") {
          var scan = Array.prototype.find.call(document.querySelectorAll("button"), function (b) { return /Scan Selected/.test(b.textContent); });
          if (scan) scan.click();
        }
        if (OPEN === "fonts") {
          var fonts = Array.prototype.find.call(document.querySelectorAll("button"), function (b) { return /Scan Project Fonts/.test(b.textContent); });
          if (fonts) fonts.click();
        }
      }, 400);
    });
  }
})();
`;

await rm(outDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
await cp(stagedExtensionDir, workDir, { recursive: true });

const ALL_TABS = ["tools", "ease", "text", "fx", "generate", "labels", "library", "media"];
const tabs = args.includes("--all") ? ALL_TABS : [flag("tab", "tools")];
const open = flag("open", "");

function seedFor(tab) {
  return {
    schemaVersion: 1,
    favourites: [],
    recents: [],
    usage: {},
    shortcuts: {},
    ui: {
      activeTab: tab,
      alignReference: "auto",
      collapsedGroups: [],
      solidColor: "#ff8f3f",
      libraryFolders: ["/Library/Motion"],
      customEases: [{ name: "Snappy", bezier: [0.7, 0, 0.2, 1] }],
    },
  };
}

const indexPath = join(workDir, "index.html");
const html = await readFile(indexPath, "utf8");
for (const tab of tabs) {
  // The tab's own "open" action, so its interesting state is what gets captured.
  const autoOpen = open || (tab === "library" ? "library" : tab === "fx" ? "fx" : "");
  const stub = `<script>var __KVFX_SEED__ = ${JSON.stringify(seedFor(tab))}; var __KVFX_OPEN__ = ${JSON.stringify(autoOpen)};${STUB}</script>`;
  await writeFile(join(workDir, `panel-${tab}.html`), html.replace("</head>", `${stub}</head>`), "utf8");
}

/**
 * Serves the bundle over HTTP.
 *
 * Chromium refuses to load ES module scripts over file:// — they are subject to
 * CORS, and a file:// origin is opaque — so the panel renders blank there. CEP
 * itself loads the panel from file://, but it relaxes that rule; a plain
 * browser does not.
 */
const MEDIA_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serve(root) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      const relative = path === "/" ? "index.html" : decodeURIComponent(path).replace(/^\/+/, "");
      // Serve only from the preview directory; a traversal is a 403, not a read.
      const resolved = join(root, relative);
      if (!resolved.startsWith(root)) {
        response.writeHead(403).end();
        return;
      }
      readFile(resolved).then(
        (body) => {
          response.writeHead(200, {
            "content-type": MEDIA_TYPES[extname(resolved)] ?? "application/octet-stream",
          });
          response.end(body);
        },
        () => response.writeHead(404).end(),
      );
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}\n${stderr}`)),
    );
  });
}

/**
 * The panel is rendered inside iframes sized to real dock widths.
 *
 * Chromium enforces a 500px minimum viewport in every headless mode, so
 * `--window-size=300` silently renders at 500 and the screenshot is simply
 * cropped — which looks exactly like missing controls. An iframe gets a true
 * narrow viewport, so what is captured is what a docked panel actually does.
 */
function contactSheet(widths, pageUrl) {
  const frames = widths
    .map(
      (width) => `
      <figure style="margin:0">
        <figcaption style="font:600 11px/1.6 system-ui;color:#79818e;padding:0 0 6px">
          ${String(width)}px
        </figcaption>
        <iframe src="${pageUrl}" width="${String(width)}" height="${String(PANEL_HEIGHT)}"
                style="border:1px solid #2a2e37;border-radius:4px;background:#0e0f12"></iframe>
      </figure>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#07080a}
    .sheet{display:flex;gap:16px;align-items:flex-start;padding:16px}
  </style></head><body><div class="sheet">${frames}</div></body></html>`;
}

const sheetWidth = widths.reduce((total, width) => total + width + 16, 16);
const server = await serve(workDir);
const { port } = server.address();

try {
  for (const tab of tabs) {
    await writeFile(join(workDir, `sheet-${tab}.html`), contactSheet(widths, `./panel-${tab}.html`), "utf8");
    const target = join(outDir, `${tab}${open ? `-${open}` : ""}.png`);
    await run(CHROMIUM, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      // Headless Chromium paints about 90px less than the window it is given.
      `--window-size=${String(Math.max(sheetWidth, 520))},${String(PANEL_HEIGHT + 160)}`,
      "--virtual-time-budget=6000",
      `--screenshot=${target}`,
      `http://127.0.0.1:${String(port)}/sheet-${tab}.html`,
    ]);
    console.log(`Rendered ${target} at ${widths.map(String).join(", ")}px`);
  }
} finally {
  server.close();
}

console.log(`\nPreviews in ${outDir}`);
