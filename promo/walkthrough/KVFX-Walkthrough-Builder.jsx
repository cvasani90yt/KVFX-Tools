/*
 * KVFX Tools - Walkthrough Builder
 *
 * Builds the long-form walkthrough (16:9, about five and a half minutes): one
 * promo for a made-up app, "Kovo", built live chapter by chapter with KVFX
 * Tools. The panel close-ups are recordings of the real panel; every result in
 * the comp viewer is made by KVFX Tools itself, because this script asks the
 * installed KVFX host to run the very plans its commands produce
 * (walkthrough-recipes.jsxinc). The voiceover sets the pace: each segment is
 * as long as its read, and captions, shots and chips follow it.
 *
 * Run: open the KVFX Tools panel once (Window > Extensions > KVFX Tools), then
 * File > Scripts > Run Script File... and pick this file. Keep the "assets"
 * folder and the two .jsxinc files next to it.
 *
 * Safety
 *   - It only ADDS a "KVFX Walkthrough" folder to the open project. Nothing
 *     already in the project changes. To remove the build, delete that folder.
 *   - Every demo scene is built in its own new comp, and a scene is only built
 *     when that comp is the active one, so no other comp is ever touched.
 *   - A missing recording, voiceover or sound is skipped or stood in for, and
 *     listed at the end; the build always finishes.
 *
 * Plain ExtendScript (ES3): no let/const, no Array.map/forEach/indexOf, no JSON.
 */

#include "walkthrough-script.jsxinc"
#include "walkthrough-shots.jsxinc"
#include "walkthrough-recipes.jsxinc"

(function kvfxWalkthroughBuilder() {

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  var CFG = {
    folderName: "KVFX Walkthrough",
    width: 1920,
    height: 1080,
    fps: 30,
    lead: 0.4,
    tail: 0.6,
    captionSize: 50,
    musicLevel: -21,
    voiceLevel: 0,
    sfxLevel: -10
  };

  var W = CFG.width;
  var H = CFG.height;
  var FD = 1 / CFG.fps;

  var C = {
    ink: hex("#0B0C0F"),
    ink2: hex("#16181E"),
    ink3: hex("#22252D"),
    stage: hex("#0F1014"),
    cream: hex("#FFF4E8"),
    white: hex("#FFFFFF"),
    amber: hex("#FF8F3F"),
    amberDeep: hex("#D9581A"),
    mute: hex("#8A8F9C"),
    green: hex("#34D399"),
    red: hex("#F43F5E"),
    missing: hex("#3A2F4A")
  };

  var FONT_CHOICES = {
    display: ["Unbounded-Black", "Unbounded-ExtraBold", "ArchivoBlack-Regular", "Anton-Regular", "Montserrat-Black", "Arial-BoldMT"],
    ui: ["Inter-Bold", "Inter18pt-Bold", "InterDisplay-Bold", "SpaceGrotesk-Bold", "Montserrat-Bold", "Arial-BoldMT"],
    body: ["Inter-Medium", "Inter18pt-Medium", "Inter-Regular", "SpaceGrotesk-Medium", "Montserrat-Medium", "ArialMT"],
    mono: ["JetBrainsMono-Bold", "JetBrainsMono-ExtraBold", "SpaceMono-Bold", "CourierNewPS-BoldMT"]
  };

  // Where things sit in a chapter: the panel on the left, the comp viewer on
  // the right, captions under the viewer.
  var PANEL = { x: 300, y: 560, scale: 53, w: 760, h: 1720 };
  var VIEW = { x: 1215, y: 496, scale: 66 };
  var VIEW_W = W * VIEW.scale / 100;
  var VIEW_H = H * VIEW.scale / 100;
  var VIEW_LEFT = VIEW.x - VIEW_W / 2;
  var VIEW_TOP = VIEW.y - VIEW_H / 2;
  var VIEW_RIGHT = VIEW.x + VIEW_W / 2;
  var CAP = { y: 962, wideY: 990, maxW: 1240 };

  var WARN = [];
  var NOTES = [];
  var MISSING = [];
  var FONT = {};
  var FOLDERS = {};
  var ASSET_DIR = null;
  var KIT_DIR = null;
  var FOOTAGE = {};
  var HOST = null;
  var STAGES = {};
  var STAGE_ERRORS = [];
  var REQUEST_ID = 0;

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  function hex(h) {
    var s = h.replace("#", "");
    return [parseInt(s.substr(0, 2), 16) / 255, parseInt(s.substr(2, 2), 16) / 255, parseInt(s.substr(4, 2), 16) / 255];
  }

  function rgba(c, a) {
    return [c[0], c[1], c[2], a === undefined ? 1 : a];
  }

  function warn(msg) {
    WARN.push(msg);
  }

  function errText(e) {
    return e && e.message ? e.message : String(e);
  }

  function cleanName(s) {
    var out = String(s).replace(/[\r\n]+/g, " ");
    return out.length > 60 ? out.substr(0, 60) : out;
  }

  function tr(l, match) {
    return l.property("ADBE Transform Group").property(match);
  }

  function setPos(l, p) {
    tr(l, "ADBE Position").setValue(p);
  }

  function setScale(l, s) {
    tr(l, "ADBE Scale").setValue([s, s, s]);
  }

  // In and out points, set in the order that keeps in before out.
  function span(l, t0, t1) {
    var hasIn = t0 !== undefined && t0 !== null;
    var hasOut = t1 !== undefined && t1 !== null;
    if (hasOut && t1 > l.outPoint) {
      l.outPoint = t1;
      if (hasIn) l.inPoint = Math.max(0, t0);
    } else {
      if (hasIn) l.inPoint = Math.max(0, t0);
      if (hasOut) l.outPoint = t1;
    }
    return l;
  }

  function spanAll(list, t0, t1) {
    for (var i = 0; i < list.length; i++) span(list[i], t0, t1);
  }

  function parentAll(list, p) {
    for (var i = 0; i < list.length; i++) list[i].parent = p;
  }

  function expr(p, s) {
    if (!p) return;
    try {
      p.expression = s;
    } catch (e) {
      warn("Expression on " + p.name + ": " + errText(e));
    }
  }

  function fixed(n) {
    return String(Math.round(n * 1000) / 1000);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function contains(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
    return false;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function clock(seconds) {
    var s = Math.floor(seconds);
    return Math.floor(s / 60) + ":" + pad2(s % 60);
  }

  // ---------------------------------------------------------------------------
  // Keyframes and easing
  // ---------------------------------------------------------------------------

  var EASES = {
    snap: [8, 90],
    smooth: [60, 60],
    soft: [33, 80],
    accel: [85, 12]
  };

  function dimsOf(p) {
    var t = p.propertyValueType;
    if (t === PropertyValueType.TwoD || t === PropertyValueType.TwoD_SPATIAL) return 2;
    if (t === PropertyValueType.ThreeD || t === PropertyValueType.ThreeD_SPATIAL) return 3;
    return 1;
  }

  function easeList(n, influence) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(new KeyframeEase(0, influence));
    return out;
  }

  function zeros(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(0);
    return out;
  }

  // Sets [time, value] pairs and eases only the keys this call made.
  function anim(p, list, mode) {
    if (!p) return;
    try {
      var times = [];
      var values = [];
      for (var i = 0; i < list.length; i++) {
        times.push(list[i][0]);
        values.push(list[i][1]);
      }
      p.setValuesAtTimes(times, values);
      var m = mode || "snap";
      for (var k = 0; k < times.length; k++) {
        var idx = p.nearestKeyIndex(times[k]);
        if (m === "hold") {
          p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        } else if (m === "linear") {
          p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
        } else {
          var e = EASES[m] || EASES.snap;
          var d = p.isSpatial ? 1 : dimsOf(p);
          p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
          p.setTemporalEaseAtKey(idx, easeList(d, e[1]), easeList(d, e[0]));
        }
        if (p.isSpatial) {
          try {
            p.setSpatialAutoBezierAtKey(idx, false);
            var z = zeros(values[k].length);
            p.setSpatialTangentsAtKey(idx, z, z);
          } catch (se) {
            // Straight spatial paths are a nicety; keep the keys either way.
          }
        }
      }
    } catch (e2) {
      warn("Keyframes on " + p.name + ": " + errText(e2));
    }
  }

  function popIn(l, t, s) {
    var v = s === undefined ? 100 : s;
    anim(tr(l, "ADBE Scale"), [[t, [0, 0, 0]], [t + 6 * FD, [v * 1.08, v * 1.08, v * 1.08]], [t + 11 * FD, [v, v, v]]], "snap");
  }

  function popOut(l, t, s) {
    var v = s === undefined ? 100 : s;
    anim(tr(l, "ADBE Scale"), [[t - 6 * FD, [v, v, v]], [t, [0, 0, 0]]], "accel");
  }

  function fadeIn(l, t, frames) {
    anim(tr(l, "ADBE Opacity"), [[t, 0], [t + (frames || 6) * FD, 100]], "smooth");
  }

  function fadeOut(l, t, frames) {
    anim(tr(l, "ADBE Opacity"), [[t - (frames || 6) * FD, 100], [t, 0]], "smooth");
  }

  // ---------------------------------------------------------------------------
  // Fonts and project structure
  // ---------------------------------------------------------------------------

  function fontInstalled(ps) {
    try {
      if (app.fonts && typeof app.fonts.getFontsByPostScriptName === "function") {
        var found = app.fonts.getFontsByPostScriptName(ps);
        return !!(found && found.length);
      }
    } catch (e) {
      // Older After Effects: no font API, cannot tell.
    }
    return null;
  }

  function pickFonts() {
    for (var role in FONT_CHOICES) {
      if (!FONT_CHOICES.hasOwnProperty(role)) continue;
      var list = FONT_CHOICES[role];
      var chosen = null;
      for (var i = 0; i < list.length; i++) {
        var ok = fontInstalled(list[i]);
        if (ok === null) {
          chosen = list[0];
          break;
        }
        if (ok) {
          chosen = list[i];
          break;
        }
      }
      if (!chosen) chosen = list[list.length - 1];
      if (chosen !== list[0]) NOTES.push(role + " font: " + list[0] + " is not installed, using " + chosen);
      FONT[role] = chosen;
    }
  }

  function uniqueFolderName(base) {
    var items = app.project.items;
    var name = base;
    var n = 1;
    var taken = true;
    while (taken) {
      taken = false;
      for (var i = 1; i <= items.length; i++) {
        if (items[i] instanceof FolderItem && items[i].name === name) {
          taken = true;
          break;
        }
      }
      if (taken) {
        n += 1;
        name = base + " " + n;
      }
    }
    return name;
  }

  function makeFolders() {
    var root = app.project.items.addFolder(uniqueFolderName(CFG.folderName));
    FOLDERS.root = root;
    var names = [["edit", "01 Edit"], ["segments", "02 Segments"], ["stages", "03 Demo Scenes"], ["parts", "04 Parts"], ["assets", "05 Assets"]];
    for (var i = 0; i < names.length; i++) {
      FOLDERS[names[i][0]] = app.project.items.addFolder(names[i][1]);
      FOLDERS[names[i][0]].parentFolder = root;
    }
  }

  function newComp(name, dur, folder, bgColor, w, h) {
    var c = app.project.items.addComp(name, w || W, h || H, 1, Math.max(FD * 2, dur), CFG.fps);
    c.parentFolder = folder;
    c.bgColor = bgColor || C.ink;
    try {
      c.motionBlur = true;
      c.shutterAngle = 180;
    } catch (e) {
      // Motion blur settings are cosmetic.
    }
    return c;
  }

  function findAssetDir() {
    var here = null;
    try {
      here = new File($.fileName).parent;
    } catch (e) {
      here = null;
    }
    if (here) {
      var d = new Folder(here.fsName + "/assets");
      if (d.exists) {
        var kit = new Folder(here.parent.fsName + "/assets");
        if (kit.exists) KIT_DIR = kit;
        return d;
      }
    }
    return Folder.selectDialog("Pick the walkthrough \"assets\" folder (Cancel builds with stand-ins)");
  }

  // A file in assets/, or in the promo kit's assets/ next to it.
  function assetFile(rel) {
    var dirs = [ASSET_DIR, KIT_DIR];
    for (var i = 0; i < dirs.length; i++) {
      if (!dirs[i]) continue;
      var f = new File(dirs[i].fsName + "/" + rel);
      if (f.exists) return f;
    }
    return null;
  }

  function importItem(file, key) {
    if (FOOTAGE.hasOwnProperty(key)) return FOOTAGE[key];
    var item = null;
    if (file) {
      try {
        var io = new ImportOptions(file);
        try {
          io.sequence = false;
        } catch (se) {
          // Not every file type has the option.
        }
        item = app.project.importFile(io);
        item.parentFolder = FOLDERS.assets;
      } catch (e) {
        warn("Could not import " + file.name + ": " + errText(e));
        item = null;
      }
    }
    FOOTAGE[key] = item;
    return item;
  }

  function footage(rel) {
    return importItem(assetFile(rel), rel);
  }

  function noteMissing(rel) {
    if (!contains(MISSING, rel)) MISSING.push(rel);
  }

  // A panel recording: assets/clips/<name>.mp4, or the promo kit's.
  function clipItem(name) {
    var item = footage("clips/" + name + ".mp4");
    if (!item) noteMissing("clips/" + name + ".mp4");
    return item;
  }

  // The voiceover for one segment: <file>.wav/.mp3, or Higgsfield's own file
  // name, which carries the job id.
  function voiceItem(seg) {
    var names = ["vo/" + seg.file + ".wav", "vo/" + seg.file + ".mp3"];
    for (var i = 0; i < names.length; i++) {
      var f = assetFile(names[i]);
      if (f) return importItem(f, names[i]);
    }
    if (ASSET_DIR) {
      var folder = new Folder(ASSET_DIR.fsName + "/vo");
      if (folder.exists) {
        var files = folder.getFiles();
        for (var j = 0; j < files.length; j++) {
          if (files[j] instanceof File && files[j].name.indexOf(seg.job) !== -1) return importItem(files[j], "vo/" + seg.job);
        }
      }
    }
    noteMissing("vo/" + seg.file + ".wav");
    return null;
  }

  // The first audio file in assets/music, if there is one.
  function musicItem() {
    if (!ASSET_DIR) return null;
    var folder = new Folder(ASSET_DIR.fsName + "/music");
    if (!folder.exists) return null;
    var files = folder.getFiles();
    for (var i = 0; i < files.length; i++) {
      if (files[i] instanceof File && /\.(wav|mp3|aif|aiff|m4a)$/i.test(files[i].name)) return importItem(files[i], "music/" + files[i].name);
    }
    return null;
  }

  function sfxItem(name) {
    var item = footage("sfx/" + name);
    return item;
  }

  // ---------------------------------------------------------------------------
  // Layers: solids, effects, shapes, text
  // ---------------------------------------------------------------------------

  function nul(comp, name, pos) {
    var l = comp.layers.addNull();
    l.name = name;
    l.label = 2;
    tr(l, "ADBE Anchor Point").setValue([0, 0]);
    if (pos) setPos(l, pos);
    return l;
  }

  function solid(comp, col, name, w, h) {
    return comp.layers.addSolid(col, name, w || comp.width, h || comp.height, 1);
  }

  function fx(l, match, name, params) {
    var idx = 0;
    try {
      idx = l.property("ADBE Effect Parade").addProperty(match).propertyIndex;
    } catch (e) {
      warn("Effect " + match + " is not available (" + l.name + ")");
      return 0;
    }
    if (name) l.property("ADBE Effect Parade").property(idx).name = name;
    if (params) {
      for (var i = 0; i < params.length; i++) {
        try {
          l.property("ADBE Effect Parade").property(idx).property(params[i][0]).setValue(params[i][1]);
        } catch (pe) {
          warn("Effect " + match + " parameter " + params[i][0] + " on " + l.name + ": " + errText(pe));
        }
      }
    }
    return idx;
  }

  function dropShadow(l, distance, softness, opacity) {
    return fx(l, "ADBE Drop Shadow", "Shadow", [[2, opacity === undefined ? 60 : opacity], [4, distance], [5, softness]]);
  }

  function radialGlow(comp, center, radius, col, opacity, name) {
    var l = solid(comp, C.ink, name || "Glow");
    if (!fx(l, "ADBE Ramp", "Radial glow", [[1, center], [2, rgba(col)], [3, [center[0] + radius, center[1]]], [4, [0, 0, 0, 1]], [5, 2]])) {
      l.remove();
      return null;
    }
    l.blendingMode = BlendingMode.ADD;
    tr(l, "ADBE Opacity").setValue(opacity);
    return l;
  }

  function shape(comp, name) {
    var l = comp.layers.addShape();
    l.name = name;
    return l;
  }

  function vroot(l) {
    return l.property("ADBE Root Vectors Group");
  }

  function addGroup(l, name) {
    var gi = vroot(l).addProperty("ADBE Vector Group").propertyIndex;
    vroot(l).property(gi).name = name;
    return gi;
  }

  function gContents(l, gi) {
    return vroot(l).property(gi).property("ADBE Vectors Group");
  }

  function gXform(l, gi) {
    return vroot(l).property(gi).property("ADBE Vector Transform Group");
  }

  function addItem(l, gi, match) {
    return gContents(l, gi).addProperty(match).propertyIndex;
  }

  function gItem(l, gi, ii) {
    return gContents(l, gi).property(ii);
  }

  function paint(l, gi, fill, stroke, strokeWidth, fillOpacity) {
    if (stroke) {
      var si = addItem(l, gi, "ADBE Vector Graphic - Stroke");
      gItem(l, gi, si).property("ADBE Vector Stroke Color").setValue(rgba(stroke));
      gItem(l, gi, si).property("ADBE Vector Stroke Width").setValue(strokeWidth || 4);
    }
    if (fill) {
      var fi = addItem(l, gi, "ADBE Vector Graphic - Fill");
      gItem(l, gi, fi).property("ADBE Vector Fill Color").setValue(rgba(fill));
      if (fillOpacity !== undefined) gItem(l, gi, fi).property("ADBE Vector Fill Opacity").setValue(fillOpacity);
    }
  }

  function rectGroup(l, name, w, h, r, center, fill, stroke, strokeWidth, fillOpacity) {
    var gi = addGroup(l, name);
    var ri = addItem(l, gi, "ADBE Vector Shape - Rect");
    gItem(l, gi, ri).property("ADBE Vector Rect Size").setValue([w, h]);
    gItem(l, gi, ri).property("ADBE Vector Rect Roundness").setValue(r || 0);
    if (center) gItem(l, gi, ri).property("ADBE Vector Rect Position").setValue(center);
    paint(l, gi, fill, stroke, strokeWidth, fillOpacity);
    return gi;
  }

  function ellipseGroup(l, name, d, center, fill, stroke, strokeWidth) {
    var gi = addGroup(l, name);
    var ei = addItem(l, gi, "ADBE Vector Shape - Ellipse");
    gItem(l, gi, ei).property("ADBE Vector Ellipse Size").setValue([d, d]);
    if (center) gItem(l, gi, ei).property("ADBE Vector Ellipse Position").setValue(center);
    paint(l, gi, fill, stroke, strokeWidth);
    return gi;
  }

  function pathGroup(l, name, verts, closed, fill, stroke, strokeWidth, inT, outT) {
    var gi = addGroup(l, name);
    var pi = addItem(l, gi, "ADBE Vector Shape - Group");
    var s = new Shape();
    s.vertices = verts;
    if (inT) s.inTangents = inT;
    if (outT) s.outTangents = outT;
    s.closed = !!closed;
    gItem(l, gi, pi).property("ADBE Vector Shape").setValue(s);
    paint(l, gi, fill, stroke, strokeWidth);
    return gi;
  }

  function repeater(l, gi, copies, offset) {
    try {
      var ri = addItem(l, gi, "ADBE Vector Filter - Repeater");
      gItem(l, gi, ri).property("ADBE Vector Repeater Copies").setValue(copies);
      gItem(l, gi, ri).property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue(offset);
    } catch (e) {
      warn("Repeater on " + l.name + ": " + errText(e));
    }
  }

  function roundedMask(l, w, h, r) {
    try {
      var k = r * 0.5523;
      var s = new Shape();
      s.vertices = [[r, 0], [w - r, 0], [w, r], [w, h - r], [w - r, h], [r, h], [0, h - r], [0, r]];
      s.inTangents = [[-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]];
      s.outTangents = [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]];
      s.closed = true;
      var mi = l.property("ADBE Mask Parade").addProperty("ADBE Mask Atom").propertyIndex;
      l.property("ADBE Mask Parade").property(mi).property("ADBE Mask Shape").setValue(s);
    } catch (e) {
      warn("Mask on " + l.name + ": " + errText(e));
    }
  }

  function dotGrid(comp, col, opacity, step) {
    var g = step || 48;
    var l = shape(comp, "Dot Grid");
    var gi = ellipseGroup(l, "dot", 5, [0, 0], col, null, 0);
    repeater(l, gi, Math.ceil(comp.width / g) + 1, [g, 0]);
    repeater(l, gi, Math.ceil(comp.height / g) + 1, [0, g]);
    setPos(l, [g / 2, g / 2]);
    tr(l, "ADBE Opacity").setValue(opacity);
    return l;
  }

  // The KVFX mark: an amber diamond with a dark core and a cream spark.
  function logoMark(comp, name, size) {
    var l = shape(comp, name);
    var spark = addGroup(l, "spark");
    var si = addItem(l, spark, "ADBE Vector Shape - Rect");
    gItem(l, spark, si).property("ADBE Vector Rect Size").setValue([size * 0.16, size * 0.16]);
    paint(l, spark, C.cream, null, 0);
    gXform(l, spark).property("ADBE Vector Position").setValue([size * 0.2, -size * 0.2]);
    gXform(l, spark).property("ADBE Vector Rotation").setValue(45);
    var core = rectGroup(l, "core", size * 0.4, size * 0.4, 0, null, C.ink, null, 0);
    gXform(l, core).property("ADBE Vector Rotation").setValue(45);
    var body = rectGroup(l, "body", size, size, size * 0.06, null, C.amber, null, 0);
    gXform(l, body).property("ADBE Vector Rotation").setValue(45);
    return l;
  }

  var LEFT = ParagraphJustification.LEFT_JUSTIFY;
  var CENTER = ParagraphJustification.CENTER_JUSTIFY;
  var RIGHT = ParagraphJustification.RIGHT_JUSTIFY;

  function textDoc(l) {
    return l.property("ADBE Text Properties").property("ADBE Text Document");
  }

  function rect0(l) {
    return l.sourceRectAtTime(l.inPoint, false);
  }

  function fitWidth(l, maxW) {
    var r = l.sourceRectAtTime(0, false);
    if (r.width <= maxW) return;
    var sp = textDoc(l);
    var td = sp.value;
    td.fontSize = Math.floor(td.fontSize * maxW / r.width);
    sp.setValue(td);
  }

  function anchorTo(l, mode) {
    var r = l.sourceRectAtTime(0, false);
    var a = [r.left + r.width / 2, r.top + r.height / 2];
    if (mode === "left") a = [r.left, r.top + r.height / 2];
    if (mode === "right") a = [r.left + r.width, r.top + r.height / 2];
    tr(l, "ADBE Anchor Point").setValue(a);
  }

  // o: font, size, color, tracking, just, maxW, anchor, pos, name, stroke
  function txt(comp, str, o) {
    o = o || {};
    var l = comp.layers.addText(str);
    var sp = textDoc(l);
    var td = sp.value;
    try {
      td.resetCharStyle();
      td.resetParagraphStyle();
    } catch (e0) {
      // Older versions: the defaults are close enough.
    }
    td.text = str;
    td.font = FONT[o.font || "ui"];
    td.fontSize = o.size || 60;
    td.applyFill = o.fill !== false;
    if (td.applyFill) td.fillColor = o.color || C.cream;
    if (o.stroke) {
      td.applyStroke = true;
      td.strokeColor = o.stroke;
      td.strokeWidth = o.strokeWidth || 4;
      td.strokeOverFill = false;
    } else {
      td.applyStroke = false;
    }
    td.tracking = o.tracking || 0;
    td.justification = o.just || CENTER;
    sp.setValue(td);
    l.name = cleanName(o.name || str);
    fitWidth(l, o.maxW || comp.width - 120);
    anchorTo(l, o.anchor || "center");
    if (o.pos) setPos(l, o.pos);
    return l;
  }

  // A pill: rounded box with one line of text, on a null that holds both.
  // o: pos, fill, ink, size, font, t0, t1, align ("left" | "right" | "center"), name
  function pill(comp, str, o) {
    var t = txt(comp, str, { font: o.font || "mono", size: o.size || 26, color: o.ink || C.ink, tracking: o.tracking === undefined ? 40 : o.tracking });
    var r = rect0(t);
    var bw = r.width + 44;
    var bh = r.height + 26;
    var box = shape(comp, "Pill box");
    rectGroup(box, "pill", bw, bh, bh / 2, [0, 0], o.fill || C.amber, null, 0);
    box.moveAfter(t);
    var x = o.pos[0];
    if (o.align === "left") x += bw / 2;
    if (o.align === "right") x -= bw / 2;
    var holder = nul(comp, o.name || "Pill \u00B7 " + str, [x, o.pos[1]]);
    parentAll([box, t], holder);
    setPos(box, [0, 0]);
    setPos(t, [0, 0]);
    spanAll([box, t, holder], o.t0, o.t1);
    return { holder: holder, width: bw, height: bh, layers: [box, t, holder] };
  }

  // ---------------------------------------------------------------------------
  // The KVFX host
  // ---------------------------------------------------------------------------

  // The panel's host script installs $.global.__kvfxHost when the panel opens.
  // If it has not been opened yet, load the script from the installed
  // extension, as the panel itself would.
  function connectHost() {
    if ($.global.__kvfxHost && typeof $.global.__kvfxHost.dispatch === "function") return $.global.__kvfxHost;
    var roots = [];
    try {
      roots.push(Folder.userData.fsName + "/Adobe/CEP/extensions");
    } catch (e) {
      // No user data folder: skip it.
    }
    try {
      roots.push(Folder.commonFiles.fsName + "/Adobe/CEP/extensions");
    } catch (e2) {
      // No common files folder: skip it.
    }
    roots.push("/Library/Application Support/Adobe/CEP/extensions");
    var here = new File($.fileName).parent;
    var candidates = [here.fsName + "/kvfx-host.jsx"];
    for (var i = 0; i < roots.length; i++) candidates.push(roots[i] + "/com.kvfx.tools/host/kvfx-host.jsx");
    for (var c = 0; c < candidates.length; c++) {
      var f = new File(candidates[c]);
      if (!f.exists) continue;
      try {
        $.evalFile(f);
      } catch (e3) {
        warn("Could not load " + f.fsName + ": " + errText(e3));
      }
      if ($.global.__kvfxHost && typeof $.global.__kvfxHost.dispatch === "function") return $.global.__kvfxHost;
    }
    return null;
  }

  // One request to the host. Its reply is always a JSON string.
  function send(request) {
    REQUEST_ID += 1;
    request.v = 1;
    request.id = "wt-" + REQUEST_ID;
    if (!request.budgetMs) request.budgetMs = 600000;
    var raw = "";
    try {
      raw = HOST.dispatch(request);
    } catch (e) {
      return { ok: false, error: { message: errText(e) } };
    }
    try {
      return eval("(" + raw + ")");
    } catch (e2) {
      return { ok: false, error: { message: "Unreadable reply from KVFX Tools" } };
    }
  }

  function layerNamed(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
  }

  function itemNamed(name) {
    for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === name) return app.project.item(i);
    return null;
  }

  // Names back to ids: {"$layer": name} becomes that layer's id in this comp.
  function resolve(value, comp) {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Array) {
      var list = [];
      for (var i = 0; i < value.length; i++) list.push(resolve(value[i], comp));
      return list;
    }
    if (typeof value["$layer"] === "string") {
      var l = layerNamed(comp, value["$layer"]);
      if (!l) throw new Error("no layer named \"" + value["$layer"] + "\"");
      return l.id;
    }
    if (typeof value["$item"] === "string") {
      var item = itemNamed(value["$item"]);
      if (!item) throw new Error("no project item named \"" + value["$item"] + "\"");
      return item.id;
    }
    var out = {};
    for (var k in value) if (value.hasOwnProperty(k)) out[k] = resolve(value[k], comp);
    return out;
  }

  function propAt(layer, path) {
    var p = layer;
    for (var i = 0; i < path.length && p; i++) p = p.property(path[i]);
    return p;
  }

  function selectFor(comp, run) {
    for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    for (var s = 0; s < run.select.length; s++) {
      var l = layerNamed(comp, run.select[s]);
      if (l) l.selected = true;
    }
    var props = run.selectProps.concat(run.selectKeys);
    for (var p = 0; p < props.length; p++) {
      var layer = layerNamed(comp, props[p].layer);
      var prop = layer ? propAt(layer, props[p].path) : null;
      if (!prop) continue;
      prop.selected = true;
    }
    for (var k = 0; k < run.selectKeys.length; k++) {
      var kl = layerNamed(comp, run.selectKeys[k].layer);
      var kp = kl ? propAt(kl, run.selectKeys[k].path) : null;
      if (!kp) continue;
      for (var n = 1; n <= kp.numKeys; n++) kp.setSelectedAtKey(n, true);
    }
  }

  function deselectAll(comp) {
    for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
  }

  // Positions of layers whose position is a plain value, by id.
  function positions(comp) {
    var out = {};
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      var p = tr(l, "ADBE Position");
      if (p.numKeys === 0 && !p.expressionEnabled && !p.dimensionsSeparated) out[l.id] = p.value;
    }
    return out;
  }

  // Turns an instant change into a move: from where each layer was to where
  // the command put it, starting at the run's time.
  function animateChange(comp, before, t) {
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      var was = before[l.id];
      if (!was) continue;
      var p = tr(l, "ADBE Position");
      var now = p.value;
      if (Math.abs(now[0] - was[0]) + Math.abs(now[1] - was[1]) < 0.5) continue;
      anim(p, [[t, was], [t + 0.55, now]], "snap");
    }
  }

  function fontFor(stage, layer) {
    for (var i = 0; i < stage.fonts.length; i++) {
      var pattern = stage.fonts[i].layer;
      var star = pattern.charAt(pattern.length - 1) === "*";
      var hit = star ? layer.name.indexOf(pattern.substr(0, pattern.length - 1)) === 0 : layer.name === pattern;
      if (hit) return FONT[stage.fonts[i].font];
    }
    return FONT.ui;
  }

  // The mock the recipes were made against has no fonts; give the text the
  // video's own.
  function restyle(comp, stage) {
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      if (!(l instanceof TextLayer)) continue;
      try {
        var sp = textDoc(l);
        var td = sp.value;
        var font = fontFor(stage, l);
        if (td.font === font) continue;
        td.font = font;
        sp.setValue(td);
      } catch (e) {
        // A text layer driven by an expression keeps its own font.
      }
    }
  }

  // Builds one demo scene with KVFX Tools, run by run.
  function buildStage(recipe) {
    var comp = newComp("WT " + recipe.id, recipe.duration, FOLDERS.stages, hex(recipe.bg), recipe.width, recipe.height);
    STAGES[recipe.id] = comp;
    for (var p = 0; p < recipe.props.length; p++) {
      var prop = recipe.props[p];
      var source = STAGES[prop.stage];
      if (!source) {
        STAGE_ERRORS.push(recipe.id + ": needs " + prop.stage + " first");
        continue;
      }
      var pl = comp.layers.add(source);
      pl.name = prop.name;
      setPos(pl, prop.position);
      setScale(pl, prop.scale);
    }
    if (!HOST) {
      standIn(comp, "Open KVFX Tools to build this scene");
      return comp;
    }
    comp.openInViewer();
    if (app.project.activeItem !== comp) {
      STAGE_ERRORS.push(recipe.id + ": After Effects did not make its comp active, so it was left empty");
      standIn(comp, "Scene not built");
      return comp;
    }
    for (var r = 0; r < recipe.runs.length; r++) {
      var run = recipe.runs[r];
      var steps;
      try {
        steps = resolve(run.steps, comp);
      } catch (e) {
        STAGE_ERRORS.push(recipe.id + " \u00B7 " + run.label + ": " + errText(e));
        continue;
      }
      comp.time = run.at;
      selectFor(comp, run);
      var before = run.animate ? positions(comp) : null;
      var reply = send({ kind: "plan", op: "kvfx.op.core.plan", args: { steps: steps }, undoGroup: run.undo });
      if (!reply.ok) {
        STAGE_ERRORS.push(recipe.id + " \u00B7 " + run.label + ": " + (reply.error ? reply.error.message : "failed"));
        continue;
      }
      if (before) animateChange(comp, before, run.at);
    }
    deselectAll(comp);
    comp.time = 0;
    restyle(comp, recipe);
    return comp;
  }

  function standIn(comp, message) {
    var bg = solid(comp, C.missing, "Stand-in");
    var t = txt(comp, message, { font: "ui", size: 54, color: C.cream, pos: [comp.width / 2, comp.height / 2] });
    t.name = "Stand-in label";
    return bg;
  }

  // ---------------------------------------------------------------------------
  // Scenes the builder draws itself: an empty comp, the silence demo and the
  // relink demo. Neither of the last two can be run here for real: one needs
  // a recorded voice and the other missing files.
  // ---------------------------------------------------------------------------

  function emptyStage() {
    var comp = newComp("WT empty", 10, FOLDERS.stages, C.stage);
    var grid = dotGrid(comp, C.mute, 18, 60);
    grid.name = "Grid";
    var title = txt(comp, "Empty comp", { font: "ui", size: 64, color: C.cream, pos: [W / 2, H / 2 - 20] });
    var sub = txt(comp, "1920 \u00D7 1080  \u00B7  30 fps  \u00B7  0 layers", { font: "mono", size: 30, color: C.mute, tracking: 60, pos: [W / 2, H / 2 + 50] });
    title.name = "Label";
    sub.name = "Size";
    return comp;
  }

  // Loudness per frame, smoothed, for the silence demo: from the voiceover
  // when the host could read it, otherwise a made-up take.
  function syntheticVoice(frames) {
    var out = [];
    var gaps = [[0.18, 0.26], [0.42, 0.5], [0.66, 0.73], [0.86, 0.9]];
    for (var f = 0; f < frames; f++) {
      var u = f / frames;
      var quiet = false;
      for (var g = 0; g < gaps.length; g++) if (u >= gaps[g][0] && u <= gaps[g][1]) quiet = true;
      out.push(quiet ? 0.3 : 5 + 4 * Math.abs(Math.sin(f * 1.3)) + 3 * Math.abs(Math.sin(f * 0.21)));
    }
    return out;
  }

  // Bars for the voice, pauses lit in amber, then the pauses close up.
  function silenceStage(samples) {
    var comp = newComp("WT silence", 8, FOLDERS.stages, C.stage);
    dotGrid(comp, C.mute, 10, 60);
    var data = samples && samples.length > 30 ? samples : syntheticVoice(600);
    var bars = 140;
    var per = Math.max(1, Math.floor(data.length / bars));
    var peak = 0;
    var levels = [];
    for (var b = 0; b < bars; b++) {
      var sum = 0;
      for (var k = 0; k < per; k++) sum += data[Math.min(data.length - 1, b * per + k)] || 0;
      levels.push(sum / per);
      if (sum / per > peak) peak = sum / per;
    }
    var threshold = peak * 0.12;
    var x0 = 220;
    var step = (W - 2 * x0) / bars;
    var mid = H / 2 + 40;
    // Phrases (loud runs) and pauses (quiet runs of 3 bars or more).
    var runs = [];
    var start = 0;
    for (var i = 1; i <= bars; i++) {
      var quietHere = i < bars && levels[i] < threshold;
      var quietBefore = levels[i - 1] < threshold;
      if (i === bars || quietHere !== quietBefore) {
        runs.push({ quiet: quietBefore && i - start >= 3, from: start, to: i });
        start = i;
      }
    }
    var removed = 0;
    var title = txt(comp, "Voiceover", { font: "mono", size: 30, color: C.mute, tracking: 80, anchor: "left", pos: [x0, mid - 230] });
    title.name = "Track";
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      var w = (run.to - run.from) * step;
      var left = x0 + run.from * step;
      if (run.quiet) {
        var gap = shape(comp, "Pause " + (r + 1));
        rectGroup(gap, "pause", w, 300, 10, [left + w / 2, mid], C.amber, null, 0, 26);
        anim(tr(gap, "ADBE Opacity"), [[1.0, 0], [1.3, 100], [2.2, 100], [2.6, 0]], "smooth");
        removed += w;
        continue;
      }
      var phrase = shape(comp, "Phrase " + (r + 1));
      var gi = addGroup(phrase, "bars");
      for (var j = run.from; j < run.to; j++) {
        var h = Math.max(6, 260 * levels[j] / (peak || 1));
        var ri = addItem(phrase, gi, "ADBE Vector Shape - Rect");
        gItem(phrase, gi, ri).property("ADBE Vector Rect Size").setValue([step * 0.62, h]);
        gItem(phrase, gi, ri).property("ADBE Vector Rect Position").setValue([x0 + (j + 0.5) * step, mid]);
        gItem(phrase, gi, ri).property("ADBE Vector Rect Roundness").setValue(step * 0.3);
      }
      paint(phrase, gi, C.cream, null, 0);
      if (removed > 0) anim(tr(phrase, "ADBE Position"), [[2.2, [0, 0]], [2.8, [-removed, 0]]], "snap");
    }
    var saved = txt(comp, "Pauses removed", { font: "ui", size: 44, color: C.amber, pos: [W / 2, mid + 230] });
    saved.name = "Result";
    anim(tr(saved, "ADBE Opacity"), [[2.6, 0], [2.9, 100]], "smooth");
    return comp;
  }

  function relinkStage() {
    var comp = newComp("WT relink", 8, FOLDERS.stages, C.stage);
    dotGrid(comp, C.mute, 10, 60);
    var files = ["voiceover-final.wav", "kovo-logo.png", "screen-capture-01.mp4"];
    var top = H / 2 - 170;
    for (var i = 0; i < files.length; i++) {
      var y = top + i * 170;
      var row = shape(comp, "Row " + (i + 1));
      rectGroup(row, "card", 1100, 130, 26, [W / 2, y], C.ink2, C.ink3, 3);
      var name = txt(comp, files[i], { font: "ui", size: 44, color: C.cream, anchor: "left", pos: [W / 2 - 500, y] });
      var bad = pill(comp, "MISSING", { pos: [W / 2 + 500, y], align: "right", fill: C.red, ink: C.white, size: 24 });
      var good = pill(comp, "RELINKED", { pos: [W / 2 + 500, y], align: "right", fill: C.green, ink: C.ink, size: 24 });
      var flip = 1.7 + i * 0.15;
      anim(tr(bad.holder, "ADBE Scale"), [[flip, [100, 100]], [flip + 0.15, [0, 0]]], "accel");
      tr(good.holder, "ADBE Scale").setValue([0, 0]);
      anim(tr(good.holder, "ADBE Scale"), [[flip + 0.1, [0, 0]], [flip + 0.3, [108, 108]], [flip + 0.42, [100, 100]]], "snap");
      name.name = "File " + (i + 1);
    }
    return comp;
  }

  // ---------------------------------------------------------------------------
  // Voiceover: where the speech starts and ends in each file
  // ---------------------------------------------------------------------------

  function analyseVoice(item) {
    if (!HOST || !item) return null;
    var probe = newComp("WT voice probe", Math.max(1, item.duration), FOLDERS.parts, C.ink, 640, 360);
    var layer = probe.layers.add(item);
    var out = null;
    probe.openInViewer();
    if (app.project.activeItem === probe) {
      var reply = send({ kind: "op", op: "kvfx.op.audio.analyse", args: { id: layer.id }, undoGroup: "KVFX Walkthrough \u2014 Analyse voice" });
      if (reply.ok && reply.result && reply.result.samples) out = { samples: reply.result.samples, fd: reply.result.frameDuration || FD };
      else warn("Could not read the loudness of " + item.name + (reply.error ? ": " + reply.error.message : ""));
    }
    probe.remove();
    return out;
  }

  function speechSpan(analysis, duration) {
    if (!analysis || analysis.samples.length === 0) return [0, duration];
    var s = analysis.samples;
    var peak = 0;
    for (var i = 0; i < s.length; i++) if (s[i] > peak) peak = s[i];
    var threshold = peak * 0.06;
    var first = 0;
    var last = s.length - 1;
    while (first < s.length && s[first] < threshold) first++;
    while (last > first && s[last] < threshold) last--;
    if (first >= last) return [0, duration];
    return [Math.max(0, first * analysis.fd - 0.06), Math.min(duration, (last + 1) * analysis.fd + 0.12)];
  }

  // Segment timing: captions spread over the speech by their length.
  function timeSegment(seg, item, analysis) {
    var caps = seg.say.split("|");
    var speech = item ? speechSpan(analysis, item.duration) : [0, 0];
    var talk = item ? speech[1] - speech[0] : Math.max(1, seg.min - CFG.lead - CFG.tail);
    var duration = Math.max(seg.min || 0, CFG.lead + talk + CFG.tail);
    var total = 0;
    var weights = [];
    for (var i = 0; i < caps.length; i++) {
      var w = caps[i].length + 6;
      weights.push(w);
      total += w;
    }
    var out = [];
    var t = CFG.lead;
    for (var c = 0; c < caps.length; c++) {
      var len = talk * weights[c] / total;
      out.push({ text: caps[c], t0: t, t1: t + len });
      t += len;
    }
    return { duration: duration, caps: out, speech: speech, item: item, analysis: analysis };
  }

  function capTime(timing, x) {
    var caps = timing.caps;
    if (x >= caps.length) return caps[caps.length - 1].t1;
    var i = Math.floor(x);
    var f = x - i;
    return caps[i].t0 + f * (caps[i].t1 - caps[i].t0);
  }

  // ---------------------------------------------------------------------------
  // Pieces of a segment
  // ---------------------------------------------------------------------------

  function background(comp) {
    var bg = solid(comp, C.ink, "Background");
    fx(bg, "ADBE Ramp", "Backdrop", [[1, [W / 2, 0]], [2, rgba(C.ink2)], [3, [W / 2, H]], [4, rgba(C.ink)]]);
    dotGrid(comp, C.mute, 7, 48);
    radialGlow(comp, [VIEW.x, VIEW.y], 900, C.amberDeep, 22, "Warm glow");
  }

  // A recording that starts at t0 from `from` seconds in, holding its first
  // and last frames, as layers of `comp`. `rate` slows it down (0 holds the
  // frame) and `loop` ([a, b]) plays that stretch over and over.
  function remapped(comp, item, name, t0, t1, from, rate, loop) {
    var l = comp.layers.add(item);
    l.name = name;
    var r = rate === undefined ? 1 : rate;
    var body = "var u = " + fixed(from) + " + (time - " + fixed(t0) + ") * " + fixed(r) + ";\n";
    if (loop) body += "if (u > " + fixed(loop[1]) + ") u = " + fixed(loop[0]) + " + (u - " + fixed(loop[0]) + ") % " + fixed(loop[1] - loop[0]) + ";\n";
    body += "Math.min(Math.max(u, 0), source.duration - thisComp.frameDuration);";
    try {
      l.timeRemapEnabled = true;
      expr(l.property("ADBE Time Remapping"), body);
    } catch (e) {
      l.startTime = t0 - from;
    }
    span(l, t0, t1);
    return l;
  }

  // Where a panel beat's recording is, dt seconds into it.
  function clipTime(panel, dt) {
    var r = panel.length > 2 ? panel[2] : 1;
    var u = panel[1] + dt * r;
    if (panel.length > 4 && u > panel[4]) u = panel[3] + (u - panel[3]) % (panel[4] - panel[3]);
    return u;
  }

  // The panel close-up: a comp the size of the recordings, so pushing in on a
  // spot stays inside its frame.
  function panelSlot(name, beats, duration) {
    var comp = newComp("WT Panel \u00B7 " + name, duration, FOLDERS.parts, C.ink2, PANEL.w, PANEL.h);
    var zoom = nul(comp, "Zoom", [PANEL.w / 2, PANEL.h / 2]);
    var clips = [];
    for (var i = 0; i < beats.length; i++) if (beats[i].panel) clips.push(beats[i]);
    for (var c = 0; c < clips.length; c++) {
      var b = clips[c];
      var t1 = c + 1 < clips.length ? clips[c + 1].t : duration;
      var item = clipItem(b.panel[0]);
      var l;
      if (item) {
        l = remapped(comp, item, "Panel \u00B7 " + b.panel[0], b.t, t1, b.panel[1], b.panel.length > 2 ? b.panel[2] : 1, b.panel.length > 4 ? [b.panel[3], b.panel[4]] : null);
        if (item.width !== PANEL.w) setScale(l, PANEL.w / item.width * 100);
      } else {
        l = solid(comp, C.missing, "MISSING " + b.panel[0]);
        span(l, b.t, t1);
      }
      setPos(l, [PANEL.w / 2, PANEL.h / 2]);
      l.parent = zoom;
    }
    // Push-ins: centre the spot, without showing past the recording's edges.
    var state = [PANEL.w / 2, PANEL.h / 2, 100];
    for (var f = 0; f < beats.length; f++) {
      var fb = beats[f];
      if (fb.focus === undefined) continue;
      var next;
      if (fb.focus === null) {
        next = [PANEL.w / 2, PANEL.h / 2, 100];
      } else {
        var k = fb.focus[2];
        var fx0 = fb.focus[0] * 2;
        var fy0 = fb.focus[1] * 2;
        var px = PANEL.w / 2 - (fx0 - PANEL.w / 2) * k;
        var py = PANEL.h / 2 - (fy0 - PANEL.h / 2) * k;
        px = clamp(px, PANEL.w - PANEL.w / 2 * k, PANEL.w / 2 * k);
        py = clamp(py, PANEL.h - PANEL.h / 2 * k, PANEL.h / 2 * k);
        next = [px, py, k * 100];
      }
      anim(tr(zoom, "ADBE Position"), [[fb.t, [state[0], state[1]]], [fb.t + 0.7, [next[0], next[1]]]], "soft");
      anim(tr(zoom, "ADBE Scale"), [[fb.t, [state[2], state[2]]], [fb.t + 0.7, [next[2], next[2]]]], "soft");
      state = next;
    }
    return comp;
  }

  function stageComp(id) {
    if (STAGES[id]) return STAGES[id];
    warn("No demo scene called " + id);
    return STAGES.empty;
  }

  // Where the panel recording is at time t of the segment.
  function panelTimeAt(beats, t) {
    var current = null;
    for (var i = 0; i < beats.length; i++) if (beats[i].panel && beats[i].t <= t + 1e-6) current = beats[i];
    return current ? clipTime(current.panel, t - current.t) : 0;
  }

  // The comp viewer: each beat's scene, fitted into 16:9.
  function viewerSlot(name, beats, duration) {
    var comp = newComp("WT Viewer \u00B7 " + name, duration, FOLDERS.parts, C.stage);
    var shots = [];
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      if (b.stage === undefined && !b.sync) continue;
      var id;
      var from;
      if (b.sync) {
        id = b.sync[0];
        from = b.sync[1] - (b.sync[2] - panelTimeAt(beats, b.t));
      } else if (b.stage === "empty") {
        id = "empty";
        from = 0;
      } else {
        id = b.stage[0];
        from = b.stage[1];
      }
      shots.push({ id: id, from: from, t: b.t });
    }
    for (var s = 0; s < shots.length; s++) {
      var shot = shots[s];
      var t1 = s + 1 < shots.length ? shots[s + 1].t : duration;
      var source = stageComp(shot.id);
      var l = remapped(comp, source, "Scene \u00B7 " + shot.id, shot.t, t1, shot.from);
      var fit = Math.min(W / source.width, H / source.height) * 100;
      setScale(l, fit);
      setPos(l, [W / 2, H / 2]);
      if (s > 0) anim(tr(l, "ADBE Scale"), [[shot.t, [fit * 0.97, fit * 0.97]], [shot.t + 0.3, [fit, fit]]], "snap");
    }
    return comp;
  }

  // Keyframe diamonds stepping down, one row per layer: "real keyframes".
  function keysOverlay(comp, t0, t1) {
    var holder = nul(comp, "Keyframes overlay", [VIEW.x, H - 230]);
    var card = shape(comp, "Keys card");
    rectGroup(card, "card", 820, 250, 24, [0, 0], C.ink, C.amber, 3, 92);
    card.parent = holder;
    setPos(card, [0, 0]);
    var parts = [card];
    for (var r = 0; r < 4; r++) {
      var row = shape(comp, "Key row " + (r + 1));
      rectGroup(row, "track", 640, 4, 2, [40, -84 + r * 56], C.ink3, null, 0);
      var d1 = addGroup(row, "in");
      var di = addItem(row, d1, "ADBE Vector Shape - Rect");
      gItem(row, d1, di).property("ADBE Vector Rect Size").setValue([20, 20]);
      paint(row, d1, C.amber, null, 0);
      gXform(row, d1).property("ADBE Vector Position").setValue([-200 + r * 70, -84 + r * 56]);
      gXform(row, d1).property("ADBE Vector Rotation").setValue(45);
      var d2 = addGroup(row, "out");
      var dj = addItem(row, d2, "ADBE Vector Shape - Rect");
      gItem(row, d2, dj).property("ADBE Vector Rect Size").setValue([20, 20]);
      paint(row, d2, C.cream, null, 0);
      gXform(row, d2).property("ADBE Vector Position").setValue([-40 + r * 70, -84 + r * 56]);
      gXform(row, d2).property("ADBE Vector Rotation").setValue(45);
      var label = txt(comp, "Layer " + (r + 1), { font: "mono", size: 20, color: C.mute, anchor: "left" });
      row.parent = holder;
      label.parent = holder;
      setPos(row, [0, 0]);
      setPos(label, [-380, -84 + r * 56]);
      parts.push(row, label);
      fadeIn(row, t0 + 0.2 + r * 0.1, 5);
    }
    parts.push(holder);
    spanAll(parts, t0, t1);
    fadeIn(holder, t0, 6);
    return holder;
  }

  // Captions under the viewer, one text layer per line on a dark plate.
  function captions(comp, timing, wideAt) {
    var holder = nul(comp, "Captions", [VIEW.x, CAP.y]);
    for (var i = 0; i < timing.caps.length; i++) {
      var cap = timing.caps[i];
      var t = txt(comp, cap.text, { font: "ui", size: CFG.captionSize, color: C.cream, maxW: CAP.maxW });
      var r = rect0(t);
      var plate = shape(comp, "Caption plate " + (i + 1));
      rectGroup(plate, "plate", r.width + 56, r.height + 30, 18, [0, 0], C.ink, null, 0, 82);
      plate.moveAfter(t);
      t.name = "Caption " + (i + 1);
      parentAll([plate, t], holder);
      setPos(plate, [0, 0]);
      setPos(t, [0, 0]);
      var t0 = cap.t0;
      var t1 = i + 1 < timing.caps.length ? timing.caps[i + 1].t0 : cap.t1 + 0.25;
      spanAll([plate, t], t0, t1);
      anim(tr(t, "ADBE Opacity"), [[t0, 0], [t0 + 4 * FD, 100]], "smooth");
      anim(tr(plate, "ADBE Opacity"), [[t0, 0], [t0 + 4 * FD, 100]], "smooth");
    }
    var state = false;
    var first = 0;
    if (wideAt.length > 0 && wideAt[0].t <= 0) {
      state = wideAt[0].wide;
      setPos(holder, state ? [W / 2, CAP.wideY] : [VIEW.x, CAP.y]);
      first = 1;
    }
    for (var w = first; w < wideAt.length; w++) {
      var to = wideAt[w].wide;
      if (to === state) continue;
      var from = state ? [W / 2, CAP.wideY] : [VIEW.x, CAP.y];
      var dest = to ? [W / 2, CAP.wideY] : [VIEW.x, CAP.y];
      anim(tr(holder, "ADBE Position"), [[wideAt[w].t, from], [wideAt[w].t + 0.5, dest]], "soft");
      state = to;
    }
    return holder;
  }

  function voiceLayer(comp, timing) {
    if (!timing.item) return null;
    var l = comp.layers.add(timing.item);
    l.name = "Voice";
    l.startTime = CFG.lead - timing.speech[0];
    span(l, CFG.lead, Math.min(comp.duration, CFG.lead + timing.speech[1] - timing.speech[0] + 0.2));
    try {
      l.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([CFG.voiceLevel, CFG.voiceLevel]);
    } catch (e) {
      // Levels are a nicety.
    }
    l.label = 9;
    return l;
  }

  function sfx(comp, name, t, level) {
    var item = sfxItem(name);
    if (!item || t < 0 || t >= comp.duration) return null;
    var l = comp.layers.add(item);
    l.name = "SFX \u00B7 " + name.replace(/\.wav$/, "");
    l.startTime = t;
    try {
      var lv = level === undefined ? CFG.sfxLevel : level;
      l.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([lv, lv]);
    } catch (e) {
      // Levels are a nicety.
    }
    l.moveToEnd();
    l.label = 13;
    return l;
  }

  // Chapter opener over the viewer, then a chip that stays.
  function chapterCard(comp, seg, duration) {
    var n = pad2(seg.chapter);
    var scrim = shape(comp, "Chapter scrim");
    rectGroup(scrim, "scrim", VIEW_W, VIEW_H, 24, [VIEW.x, VIEW.y], C.ink, null, 0, 94);
    var num = txt(comp, n, { font: "display", size: 300, fill: false, stroke: C.amber, strokeWidth: 4, pos: [VIEW.x, VIEW.y - 90] });
    var title = txt(comp, seg.title, { font: "display", size: 92, color: C.cream, pos: [VIEW.x, VIEW.y + 110], maxW: VIEW_W - 120 });
    var of = txt(comp, "CHAPTER " + seg.chapter + " OF 8", { font: "mono", size: 26, color: C.amber, tracking: 160, pos: [VIEW.x, VIEW.y + 200] });
    var parts = [scrim, num, title, of];
    spanAll(parts, 0, 2.1);
    anim(tr(num, "ADBE Scale"), [[0.05, [140, 140]], [0.4, [100, 100]]], "snap");
    fadeIn(num, 0.05, 4);
    anim(tr(title, "ADBE Position"), [[0.12, [VIEW.x, VIEW.y + 170]], [0.5, [VIEW.x, VIEW.y + 110]]], "snap");
    fadeIn(title, 0.12, 6);
    fadeIn(of, 0.3, 6);
    for (var i = 0; i < parts.length; i++) fadeOut(parts[i], 2.1, 8);
    var chip = pill(comp, n + " / 08   " + seg.title.toUpperCase(), { pos: [VIEW_LEFT, 68], align: "left", fill: C.amber, ink: C.ink, size: 24 });
    spanAll(chip.layers, 1.8, duration);
    fadeIn(chip.holder, 1.8, 8);
    return chip;
  }

  function featureChip(comp, text, t0, t1) {
    var chip = pill(comp, text, { pos: [VIEW_RIGHT, 68], align: "right", fill: C.ink2, ink: C.cream, size: 24 });
    spanAll(chip.layers, t0, t1);
    popIn(chip.holder, t0, 100);
    return chip;
  }

  // ---------------------------------------------------------------------------
  // A chapter: panel on the left, viewer on the right, captions below
  // ---------------------------------------------------------------------------

  function timedBeats(list, timing) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var b = {};
      for (var k in list[i]) if (list[i].hasOwnProperty(k)) b[k] = list[i][k];
      b.t = list[i].cap === 0 ? 0 : capTime(timing, list[i].cap);
      out.push(b);
    }
    return out;
  }

  function buildChapter(seg, timing, index) {
    var duration = timing.duration;
    var beats = timedBeats(WT_SHOTS[seg.id] || [], timing);
    var comp = newComp("WT Seg \u00B7 " + pad2(index + 1) + " " + seg.title, duration, FOLDERS.segments, C.ink);
    background(comp);

    var slot = panelSlot(seg.id, beats, duration);
    var viewer = viewerSlot(seg.id, beats, duration);

    var panel = comp.layers.add(slot);
    panel.name = "Panel";
    setScale(panel, PANEL.scale);
    setPos(panel, [PANEL.x, PANEL.y]);
    roundedMask(panel, PANEL.w, PANEL.h, 40);
    var bezel = shape(comp, "Panel bezel");
    rectGroup(bezel, "bezel", PANEL.w + 30, PANEL.h + 30, 52, [0, 0], C.ink2, C.ink3, 4);
    bezel.moveAfter(panel);
    bezel.parent = panel;
    setPos(bezel, [PANEL.w / 2, PANEL.h / 2]);
    dropShadow(bezel, 18, 70, 60);

    var view = comp.layers.add(viewer);
    view.name = "Viewer";
    setScale(view, VIEW.scale);
    setPos(view, [VIEW.x, VIEW.y]);
    roundedMask(view, W, H, 30);
    var frame = shape(comp, "Viewer frame");
    rectGroup(frame, "frame", W + 8, H + 8, 32, [0, 0], null, C.ink3, 6);
    frame.moveBefore(view);
    frame.parent = view;
    setPos(frame, [W / 2, H / 2]);
    var shadow = shape(comp, "Viewer shadow");
    rectGroup(shadow, "shadow", W, H, 30, [0, 0], C.ink, null, 0);
    shadow.moveAfter(view);
    shadow.parent = view;
    setPos(shadow, [W / 2, H / 2]);
    dropShadow(shadow, 20, 90, 65);

    // Wide shots: the viewer fills the frame and the panel steps aside.
    var wideAt = [];
    var wide = false;
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      if (b.wide === undefined || b.wide === wide) continue;
      var t = b.t;
      var fromV = wide ? [[W / 2, H / 2], 100] : [[VIEW.x, VIEW.y], VIEW.scale];
      var toV = b.wide ? [[W / 2, H / 2], 100] : [[VIEW.x, VIEW.y], VIEW.scale];
      anim(tr(view, "ADBE Position"), [[t, fromV[0]], [t + 0.5, toV[0]]], "soft");
      anim(tr(view, "ADBE Scale"), [[t, [fromV[1], fromV[1]]], [t + 0.5, [toV[1], toV[1]]]], "soft");
      var px = b.wide ? -420 : PANEL.x;
      anim(tr(panel, "ADBE Position"), [[t, [wide ? -420 : PANEL.x, PANEL.y]], [t + 0.5, [px, PANEL.y]]], "soft");
      sfx(comp, b.wide ? "whoosh-03.wav" : "whoosh-05.wav", t - 0.15);
      wideAt.push({ t: t, wide: b.wide });
      if (b.keys) keysOverlay(comp, t + 0.5, i + 1 < beats.length ? beats[i + 1].t : duration);
      wide = b.wide;
    }

    // Click sounds where the recording clicks.
    for (var c = 0; c < beats.length; c++) {
      var cb = beats[c];
      if (!cb.panel) continue;
      var end = duration;
      for (var n = c + 1; n < beats.length; n++) {
        if (beats[n].panel) {
          end = beats[n].t;
          break;
        }
      }
      var rate = cb.panel.length > 2 ? cb.panel[2] : 1;
      if (rate <= 0 || cb.panel.length > 4) continue;
      var clicks = WT_CLIP_CLICKS[cb.panel[0]] || [];
      for (var k = 0; k < clicks.length; k++) {
        var at = cb.t + (clicks[k] - cb.panel[1]) / rate;
        if (clicks[k] >= cb.panel[1] && at < end) sfx(comp, "ui-glass-click.wav", at, -14);
      }
    }

    // Feature chips, each until the next one.
    var chips = [];
    for (var f = 0; f < beats.length; f++) if (beats[f].chip) chips.push(beats[f]);
    for (var h = 0; h < chips.length; h++) {
      var until = Math.min(chips[h].t + 4.5, h + 1 < chips.length ? chips[h + 1].t : duration);
      featureChip(comp, chips[h].chip, chips[h].t + 0.1, until);
      sfx(comp, "ui-05.wav", chips[h].t + 0.1, -18);
    }

    if (seg.chapter) {
      chapterCard(comp, seg, duration);
      sfx(comp, "riser-hit-1.wav", 0, -16);
    }
    captions(comp, timing, wideAt);
    voiceLayer(comp, timing);
    return comp;
  }

  // ---------------------------------------------------------------------------
  // The Kovo promo, 16:9, and its 9:16 copy made with Comp Resizer
  // ---------------------------------------------------------------------------

  function buildPromo() {
    var total = 0;
    for (var i = 0; i < WT_PROMO.length; i++) total += WT_PROMO[i][2];
    var comp = newComp("Kovo Promo 16x9", total, FOLDERS.edit, C.stage);
    var t = 0;
    for (var s = 0; s < WT_PROMO.length; s++) {
      var shot = WT_PROMO[s];
      var source = stageComp(shot[0]);
      var l = remapped(comp, source, "Shot \u00B7 " + shot[0], t, t + shot[2], shot[1]);
      var fit = Math.min(W / source.width, H / source.height) * 100;
      setPos(l, [W / 2, H / 2]);
      anim(tr(l, "ADBE Scale"), [[t, [fit * 1.06, fit * 1.06]], [t + shot[2], [fit, fit]]], "linear");
      if (s > 0) {
        var flash = solid(comp, C.white, "Flash");
        flash.blendingMode = BlendingMode.ADD;
        tr(flash, "ADBE Opacity").setValue(55);
        span(flash, t, t + 2 * FD);
      }
      t += shot[2];
    }
    return comp;
  }

  function buildVertical(promo) {
    var copy = promo.duplicate();
    copy.name = "Kovo Promo 9x16";
    copy.parentFolder = FOLDERS.edit;
    if (!HOST) {
      warn("The 9:16 promo needs KVFX Tools for Comp Resizer; it was left at 16:9");
      return copy;
    }
    copy.openInViewer();
    for (var i = 1; i <= app.project.numItems; i++) app.project.item(i).selected = false;
    copy.selected = true;
    if (app.project.activeItem !== copy) {
      warn("Could not make the 9:16 copy active, so it was not resized");
      return copy;
    }
    var reply = send({ kind: "plan", op: "kvfx.op.core.plan", args: { steps: WT_RESIZE.steps }, undoGroup: WT_RESIZE.undo });
    copy.selected = false;
    if (!reply.ok) {
      warn("Comp Resizer: " + (reply.error ? reply.error.message : "failed"));
      return copy;
    }
    // Fill the bands above and below with a soft, dark copy of the promo.
    var back = copy.layers.add(promo);
    back.name = "Backdrop blur";
    back.moveToEnd();
    setScale(back, copy.height / promo.height * 100);
    setPos(back, [copy.width / 2, copy.height / 2]);
    fx(back, "ADBE Box Blur2", "Soften", [[1, 60], [2, 3]]);
    fx(back, "ADBE Tint", "Darken", [[1, rgba(C.ink)], [2, rgba(C.ink2)], [3, 60]]);
    var title = txt(copy, "Kovo", { font: "display", size: 120, color: C.cream, pos: [copy.width / 2, 300] });
    var line = txt(copy, "Numbers that move.", { font: "ui", size: 58, color: C.amber, pos: [copy.width / 2, copy.height - 330] });
    title.name = "Title";
    line.name = "Tagline";
    return copy;
  }

  // ---------------------------------------------------------------------------
  // The segments that are not chapters
  // ---------------------------------------------------------------------------

  function plainSegment(seg, timing, index) {
    return newComp("WT Seg \u00B7 " + pad2(index + 1) + " " + seg.id, timing.duration, FOLDERS.segments, C.ink);
  }

  // Result first: the finished promo, full frame.
  function buildHook(seg, timing, index, promo) {
    var comp = plainSegment(seg, timing, index);
    var l = remapped(comp, promo, "Kovo promo", 0, timing.duration, 0);
    setPos(l, [W / 2, H / 2]);
    var badge = pill(comp, "MADE IN AFTER EFFECTS \u00B7 KVFX TOOLS", { pos: [60, 70], align: "left", fill: C.amber, ink: C.ink, size: 24 });
    spanAll(badge.layers, 0.3, timing.duration);
    popIn(badge.holder, 0.3, 100);
    captions(comp, timing, [{ t: 0, wide: true }]);
    voiceLayer(comp, timing);
    sfx(comp, "hit-bass.wav", 0, -12);
    return comp;
  }

  // What it costs by hand: three chores pile up over the frozen promo.
  function buildProblem(seg, timing, index, promo) {
    var comp = plainSegment(seg, timing, index);
    background(comp);
    var still = comp.layers.add(promo);
    still.name = "Promo (held)";
    try {
      still.timeRemapEnabled = true;
      expr(still.property("ADBE Time Remapping"), "Math.max(0, " + fixed(Math.min(promo.duration - FD, 9)) + " - time * 3);");
    } catch (e) {
      // A plain layer is fine too.
    }
    anim(tr(still, "ADBE Position"), [[0, [W / 2, H / 2]], [0.8, [VIEW.x, VIEW.y]]], "soft");
    anim(tr(still, "ADBE Scale"), [[0, [100, 100]], [0.8, [VIEW.scale, VIEW.scale]]], "soft");
    roundedMask(still, W, H, 30);
    var letsGo = capTime(timing, 3);
    fadeOut(still, letsGo + 0.4, 10);
    span(still, 0, letsGo + 0.4);

    var chores = [["Shape layers", capTime(timing, 1)], ["Stagger offsets", capTime(timing, 1.5)], ["Graph editor tweaks", capTime(timing, 2)]];
    for (var i = 0; i < chores.length; i++) {
      var y = 330 + i * 190;
      var card = shape(comp, "Chore card " + (i + 1));
      rectGroup(card, "card", 440, 150, 24, [PANEL.x, y], C.ink2, C.ink3, 3);
      var label = txt(comp, chores[i][0], { font: "ui", size: 40, color: C.cream, pos: [PANEL.x, y - 12] });
      var cost = txt(comp, "by hand", { font: "mono", size: 22, color: C.mute, tracking: 80, pos: [PANEL.x, y + 38] });
      var parts = [card, label, cost];
      spanAll(parts, chores[i][1], letsGo + 0.3);
      for (var p = 0; p < parts.length; p++) {
        anim(tr(parts[p], "ADBE Opacity"), [[chores[i][1], 0], [chores[i][1] + 0.2, 100]], "smooth");
        fadeOut(parts[p], letsGo + 0.3, 8);
      }
      sfx(comp, "ui-03.wav", chores[i][1], -16);
    }
    var afternoon = pill(comp, "\u2248 AN AFTERNOON", { pos: [VIEW_RIGHT, 68], align: "right", fill: C.red, ink: C.white, size: 24 });
    spanAll(afternoon.layers, capTime(timing, 0.4), letsGo + 0.3);
    popIn(afternoon.holder, capTime(timing, 0.4), 100);

    var build = txt(comp, "Let's build it.", { font: "display", size: 110, color: C.cream, pos: [W / 2, H / 2 - 40] });
    span(build, letsGo + 0.3, timing.duration);
    anim(tr(build, "ADBE Scale"), [[letsGo + 0.3, [120, 120]], [letsGo + 0.7, [100, 100]]], "snap");
    fadeIn(build, letsGo + 0.3, 6);
    captions(comp, timing, []);
    voiceLayer(comp, timing);
    sfx(comp, "whoosh-02.wav", letsGo + 0.15);
    return comp;
  }

  // The brand: mark and name, then the panel and an empty comp.
  function buildBrand(seg, timing, index) {
    var beats = [
      { cap: 1, panel: ["wt-tour", 0], stage: "empty" }
    ];
    beats = timedBeats(beats, timing);
    var comp = plainSegment(seg, timing, index);
    background(comp);
    var tabs = beats[0].t;

    var mark = logoMark(comp, "KVFX mark", 180);
    setPos(mark, [W / 2, H / 2 - 110]);
    anim(tr(mark, "ADBE Rotate Z"), [[0.05, -180], [0.7, 0]], "snap");
    popIn(mark, 0.05, 100);
    var word = txt(comp, "KVFX TOOLS", { font: "display", size: 120, color: C.cream, tracking: 40, pos: [W / 2, H / 2 + 110] });
    var tag = txt(comp, "a motion design panel for After Effects", { font: "body", size: 40, color: C.mute, pos: [W / 2, H / 2 + 200] });
    fadeIn(word, 0.35, 8);
    fadeIn(tag, 0.6, 8);
    spanAll([mark, word, tag], 0, tabs + 0.3);
    for (var i = 0; i < 3; i++) fadeOut([mark, word, tag][i], tabs + 0.3, 8);
    sfx(comp, "riser-hit-2.wav", 0, -12);

    // From the second line on, the chapter layout with the tab tour.
    var slot = panelSlot("brand", beats, timing.duration);
    var panel = comp.layers.add(slot);
    panel.name = "Panel";
    setScale(panel, PANEL.scale);
    roundedMask(panel, PANEL.w, PANEL.h, 40);
    anim(tr(panel, "ADBE Position"), [[tabs, [-420, PANEL.y]], [tabs + 0.5, [PANEL.x, PANEL.y]]], "soft");
    span(panel, tabs, timing.duration);
    var shown = capTime(timing, 3) - 0.2;
    var view = remapped(comp, stageComp("empty"), "Viewer", shown, timing.duration, 0);
    setScale(view, VIEW.scale);
    setPos(view, [VIEW.x, VIEW.y]);
    roundedMask(view, W, H, 30);
    fadeIn(view, shown, 8);

    var stats = [["8 TABS", 1], ["100+ COMMANDS", 1.5], ["1 UNDO EACH", 2.2]];
    for (var s = 0; s < stats.length; s++) {
      var at = capTime(timing, stats[s][1]);
      var chip = pill(comp, stats[s][0], { pos: [VIEW.x, VIEW.y - 160 + s * 120], fill: s === 2 ? C.amber : C.cream, ink: C.ink, size: 40 });
      spanAll(chip.layers, at, capTime(timing, 3) - 0.1);
      popIn(chip.holder, at, 100);
      sfx(comp, "ui-07.wav", at, -14);
    }
    captions(comp, timing, []);
    voiceLayer(comp, timing);
    return comp;
  }

  // Both versions side by side, then the call to action.
  function buildEnd(seg, timing, index, promo, vertical) {
    var comp = plainSegment(seg, timing, index);
    background(comp);
    var ask = capTime(timing, 2);
    var land = remapped(comp, promo, "Promo 16:9", 0, ask + 0.4, 0);
    setScale(land, 58);
    setPos(land, [690, 470]);
    roundedMask(land, W, H, 30);
    var tall = remapped(comp, vertical, "Promo 9:16", 0, ask + 0.4, 0);
    setScale(tall, 41);
    setPos(tall, [1530, 480]);
    roundedMask(tall, vertical.width, vertical.height, 40);
    var tag1 = pill(comp, "16:9", { pos: [690, 110], fill: C.ink2, ink: C.cream, size: 24 });
    var tag2 = pill(comp, "9:16", { pos: [1530, 70], fill: C.ink2, ink: C.cream, size: 24 });
    spanAll(tag1.layers.concat(tag2.layers), 0, ask + 0.4);
    fadeIn(land, 0, 8);
    fadeIn(tall, 0.2, 8);
    fadeOut(land, ask + 0.4, 8);
    fadeOut(tall, ask + 0.4, 8);

    var mark = logoMark(comp, "KVFX mark", 140);
    setPos(mark, [W / 2, 300]);
    var word = txt(comp, "KVFX TOOLS", { font: "display", size: 110, color: C.cream, tracking: 40, pos: [W / 2, 470] });
    var link = pill(comp, "LINK IN THE DESCRIPTION", { pos: [W / 2, 610], fill: C.amber, ink: C.ink, size: 34 });
    var sub = pill(comp, "SUBSCRIBE", { pos: [W / 2 - 170, 730], fill: C.cream, ink: C.ink, size: 30 });
    var comment = pill(comp, "WHICH TOOL FIRST?", { pos: [W / 2 + 200, 730], fill: C.ink2, ink: C.cream, size: 30 });
    spanAll([mark, word], ask, timing.duration);
    popIn(mark, ask, 100);
    fadeIn(word, ask + 0.15, 8);
    spanAll(link.layers, ask + 0.3, timing.duration);
    popIn(link.holder, ask + 0.3, 100);
    spanAll(sub.layers, capTime(timing, 3), timing.duration);
    popIn(sub.holder, capTime(timing, 3), 100);
    spanAll(comment.layers, capTime(timing, 4), timing.duration);
    popIn(comment.holder, capTime(timing, 4), 100);
    sfx(comp, "riser-hit-3.wav", ask - 0.6, -12);
    captions(comp, timing, [{ t: 0, wide: true }]);
    voiceLayer(comp, timing);
    return comp;
  }

  // ---------------------------------------------------------------------------
  // MAIN: the segments back to back, music, progress bar, chapter markers
  // ---------------------------------------------------------------------------

  function buildMain(segments) {
    var total = 0;
    for (var i = 0; i < segments.length; i++) total += segments[i].comp.duration;
    var main = newComp("WT \u00B7 MAIN 16x9", total, FOLDERS.edit, C.ink);
    var t = 0;
    var chapters = [];
    var guide = nul(main, "Chapters (guide)", [80, 80]);
    guide.guideLayer = true;
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      var l = main.layers.add(seg.comp);
      l.startTime = t;
      l.moveToEnd();
      var label = seg.seg.chapter ? seg.seg.title : seg.seg.id === "hook" ? "The result first" : seg.seg.id === "end" ? "Both versions" : seg.seg.id === "brand" ? "KVFX Tools" : "By hand";
      if (seg.seg.id !== "problem" && seg.seg.id !== "brand") chapters.push([t, label]);
      var marker = new MarkerValue(label);
      guide.property("ADBE Marker").setValueAtTime(t, marker);
      t += seg.comp.duration;
    }

    // A thin progress line across the top.
    var bar = shape(main, "Progress");
    rectGroup(bar, "track", W, 6, 0, [W / 2, 3], C.ink3, null, 0);
    var fill = rectGroup(bar, "fill", W, 6, 0, [W / 2, 3], C.amber, null, 0);
    gXform(bar, fill).property("ADBE Vector Anchor").setValue([0, 3]);
    gXform(bar, fill).property("ADBE Vector Position").setValue([0, 3]);
    expr(gXform(bar, fill).property("ADBE Vector Scale"), "[100 * time / thisComp.duration, 100];");
    setPos(bar, [0, 0]);
    tr(bar, "ADBE Anchor Point").setValue([0, 0]);

    // Light grain over everything.
    var grain = main.layers.addSolid(C.ink, "Grain", W, H, 1);
    grain.adjustmentLayer = true;
    fx(grain, "ADBE Noise", "Grain", [[1, 2.5]]);

    var music = musicItem();
    if (music) {
      var m = main.layers.add(music);
      m.name = "Music";
      m.moveToEnd();
      try {
        var lv = m.property("ADBE Audio Group").property("ADBE Audio Levels");
        lv.setValue([CFG.musicLevel, CFG.musicLevel]);
        anim(lv, [[Math.max(0, total - 2.5), [CFG.musicLevel, CFG.musicLevel]], [total, [-60, -60]]], "smooth");
      } catch (e) {
        // Levels are a nicety.
      }
      if (music.duration < total) NOTES.push("The music is shorter than the video (" + clock(music.duration) + " of " + clock(total) + "); loop or extend it.");
    } else {
      NOTES.push("No music: put a licensed track in assets/music and run again, or add it in MAIN.");
    }
    return { comp: main, chapters: chapters };
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  function build() {
    if (!app.project) app.newProject();
    pickFonts();
    ASSET_DIR = findAssetDir();
    HOST = connectHost();
    if (!HOST) NOTES.push("KVFX Tools was not found, so the demo scenes are stand-ins. Open the panel once (Window > Extensions > KVFX Tools) and run this again.");
    makeFolders();

    STAGES.empty = emptyStage();
    for (var r = 0; r < WT_RECIPES.length; r++) buildStage(WT_RECIPES[r]);

    // Voices first: their lengths set the whole timeline.
    var timings = [];
    var shipAnalysis = null;
    for (var v = 0; v < WT_SCRIPT.length; v++) {
      var seg = WT_SCRIPT[v];
      var item = voiceItem(seg);
      var analysis = analyseVoice(item);
      if (seg.id === "ship") shipAnalysis = analysis;
      timings.push(timeSegment(seg, item, analysis));
    }
    STAGES.silence = silenceStage(shipAnalysis ? shipAnalysis.samples : null);
    STAGES.relink = relinkStage();

    var promo = buildPromo();
    var vertical = buildVertical(promo);
    STAGES.promo16 = promo;
    STAGES.promo9 = vertical;

    var segments = [];
    for (var s = 0; s < WT_SCRIPT.length; s++) {
      var sg = WT_SCRIPT[s];
      var tm = timings[s];
      var comp;
      if (sg.id === "hook") comp = buildHook(sg, tm, s, promo);
      else if (sg.id === "problem") comp = buildProblem(sg, tm, s, promo);
      else if (sg.id === "brand") comp = buildBrand(sg, tm, s);
      else if (sg.id === "end") comp = buildEnd(sg, tm, s, promo, vertical);
      else comp = buildChapter(sg, tm, s);
      segments.push({ seg: sg, comp: comp });
    }
    var main = buildMain(segments);
    main.comp.openInViewer();
    return main;
  }

  function report(main) {
    var lines = ["KVFX walkthrough built: " + main.comp.name + " (" + clock(main.comp.duration) + ")."];
    lines.push("");
    lines.push("YouTube chapters:");
    for (var c = 0; c < main.chapters.length; c++) lines.push(clock(main.chapters[c][0]) + " " + main.chapters[c][1]);
    if (STAGE_ERRORS.length) {
      lines.push("");
      lines.push("Demo scenes that need a look (" + STAGE_ERRORS.length + "):");
      for (var e = 0; e < STAGE_ERRORS.length && e < 12; e++) lines.push("  " + STAGE_ERRORS[e]);
    }
    if (MISSING.length) {
      lines.push("");
      lines.push("Not found in assets/ (" + MISSING.length + "): " + MISSING.join(", "));
    }
    if (NOTES.length) {
      lines.push("");
      for (var n = 0; n < NOTES.length; n++) lines.push(NOTES[n]);
    }
    if (WARN.length) {
      lines.push("");
      lines.push("Warnings (" + WARN.length + "):");
      for (var w = 0; w < WARN.length && w < 10; w++) lines.push("  " + WARN[w]);
    }
    alert(lines.join("\n"), "KVFX Walkthrough");
  }

  app.beginUndoGroup("KVFX Walkthrough Builder");
  var result = null;
  try {
    result = build();
  } catch (err) {
    alert("The walkthrough build stopped: " + errText(err) + (err.line ? " (line " + err.line + ")" : ""), "KVFX Walkthrough");
  } finally {
    app.endUndoGroup();
  }
  if (result) report(result);
})();
