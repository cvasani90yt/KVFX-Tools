/*
 * KVFX Tools - Promo Builder
 *
 * Builds the vertical KVFX Tools promo inside After Effects: seven scenes,
 * a camera rig per shot, every text animation and a callout for each panel
 * feature the video shows. What you get is a normal, editable project, so it
 * can be retimed to music, restyled or rendered as it is.
 *
 * Run: File > Scripts > Run Script File... and pick this file.
 *
 * Safety
 *   - It only ADDS a "KVFX Promo" folder to the open project. Nothing already
 *     in the project is changed, and Edit > Undo removes the whole build.
 *   - Assets are read from the "assets" folder next to this file. A missing
 *     file becomes a clearly named placeholder, so the build always finishes;
 *     drop the file in later and use File > Replace Footage.
 *
 * Plain ExtendScript (ES3): no let/const, no Array.map/forEach/indexOf, no JSON.
 */

(function kvfxPromoBuilder() {

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  var CFG = {
    folderName: "KVFX Promo",
    width: 1080,
    height: 1920,
    fps: 30,
    bpm: 120,
    zoom: 1600,
    grain: 3,
    youtubeVersion: true
  };

  var SCENES = [
    { key: "hook", name: "01 Hook", dur: 3.0 },
    { key: "brand", name: "02 Brand Sting", dur: 2.5 },
    { key: "panel", name: "03 Inside The Panel", dur: 12.8 },
    { key: "anime", name: "04 Anime Edits", dur: 13.0 },
    { key: "saas", name: "05 SaaS Promo", dur: 11.0 },
    { key: "mograph", name: "06 Everyday Mograph", dur: 8.0 },
    { key: "features", name: "07 Feature Wall", dur: 4.5 },
    { key: "cta", name: "08 Call To Action", dur: 3.5 }
  ];

  var W = CFG.width;
  var H = CFG.height;
  var CX = W / 2;
  var CY = H / 2;
  var FD = 1 / CFG.fps;

  var C = {
    ink: hex("#0B0C0F"),
    ink2: hex("#16181E"),
    ink3: hex("#22252D"),
    cream: hex("#FFF4E8"),
    paper: hex("#F4EFE6"),
    white: hex("#FFFFFF"),
    amber: hex("#FF8F3F"),
    amberDeep: hex("#D9581A"),
    amberDark: hex("#6E2C0C"),
    teal: hex("#1FD1C1"),
    pink: hex("#FF5FA2"),
    mute: hex("#8A8F9C"),
    red: hex("#FF2A3A"),
    cyan: hex("#2AF0FF"),
    missing: hex("#3A2F4A")
  };

  // First installed font in each list wins. All of the first choices are free
  // on Google Fonts; the last entry of each list ships with every OS.
  var FONT_CHOICES = {
    display: ["Unbounded-Black", "Unbounded-ExtraBold", "ArchivoBlack-Regular", "Anton-Regular", "Montserrat-Black", "Arial-BoldMT"],
    ui: ["Inter-Bold", "Inter18pt-Bold", "InterDisplay-Bold", "SpaceGrotesk-Bold", "Montserrat-Bold", "Arial-BoldMT"],
    body: ["Inter-Medium", "Inter18pt-Medium", "Inter-Regular", "SpaceGrotesk-Medium", "Montserrat-Medium", "ArialMT"],
    mono: ["JetBrainsMono-Bold", "JetBrainsMono-ExtraBold", "SpaceMono-Bold", "CourierNewPS-BoldMT"]
  };

  // Every command name the panel ships with a counterpart for - used by the
  // scrolling ticker in the feature wall.
  var TICKER_A = "SPLIT  \u00B7  PRECOMP EACH  \u00B7  TRIM TO WA  \u00B7  NULL PARENT  \u00B7  SEQUENCE  \u00B7  GRADIENT LOCK  \u00B7  DUPLICATE COMP + NESTED  \u00B7  ANCHOR GRID  \u00B7  ALIGN  \u00B7  DISTRIBUTE  \u00B7  ";
  var TICKER_B = "ADD ELASTIC  \u00B7  ADD BOUNCE  \u00B7  ADD WIGGLE  \u00B7  LOOP  \u00B7  PING-PONG  \u00B7  NUMBER COUNTER  \u00B7  3D CAROUSEL  \u00B7  3D EXTRUDE  \u00B7  EXPLODE TEXT  \u00B7  REPLACE FONTS  \u00B7  ";

  var WARN = [];
  var MISSING = [];
  var FONT = {};
  var FONT_NOTES = [];
  var FOLDERS = {};
  var ASSET_DIR = null;
  var FOOTAGE = {};

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

  function span(l, t0, t1) {
    if (t0 !== undefined && t0 !== null) l.inPoint = t0;
    if (t1 !== undefined && t1 !== null) l.outPoint = t1;
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

  function depthK(z) {
    return (CFG.zoom + z) / CFG.zoom;
  }

  // ---------------------------------------------------------------------------
  // Keyframes and easing
  // ---------------------------------------------------------------------------

  // [outgoing influence of the departing key, incoming influence of the
  // arriving key]. "snap" is the fast-out, long-settle curve that most of the
  // video uses; "accel" is its mirror for exits.
  var EASES = {
    snap: [8, 90],
    smooth: [60, 60],
    soft: [33, 80],
    accel: [85, 12]
  };

  function dimsOf(p) {
    var t = p.propertyValueType;
    if (t === PropertyValueType.TwoD) return 2;
    if (t === PropertyValueType.ThreeD) return 3;
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

  // Sets [time, value] pairs and eases only the keys this call made, so a
  // property can take a snappy entrance and an accelerating exit.
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
          var d = dimsOf(p);
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

  // Scale pop with a small overshoot. Works for 2D and 3D layers.
  function popIn(l, t, s) {
    var v = s === undefined ? 100 : s;
    anim(tr(l, "ADBE Scale"), [[t, [0, 0, 0]], [t + 6 * FD, [v * 1.12, v * 1.12, v * 1.12]], [t + 11 * FD, [v, v, v]]], "snap");
  }

  function popOut(l, t, s) {
    var v = s === undefined ? 100 : s;
    anim(tr(l, "ADBE Scale"), [[t - 6 * FD, [v, v, v]], [t, [0, 0, 0]]], "accel");
  }

  // Big-to-normal "slam" with an opacity flick.
  function slam(l, t, from) {
    var f = from || 170;
    anim(tr(l, "ADBE Scale"), [[t, [f, f, f]], [t + 5 * FD, [94, 94, 94]], [t + 9 * FD, [100, 100, 100]]], "snap");
    anim(tr(l, "ADBE Opacity"), [[t, 0], [t + 2 * FD, 100]], "linear");
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
      if (chosen !== list[0]) FONT_NOTES.push(role + ": " + list[0] + " not installed, using " + chosen);
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
    FOLDERS.scenes = app.project.items.addFolder("01 Scenes");
    FOLDERS.scenes.parentFolder = root;
    FOLDERS.parts = app.project.items.addFolder("02 Parts");
    FOLDERS.parts.parentFolder = root;
    FOLDERS.assets = app.project.items.addFolder("03 Assets");
    FOLDERS.assets.parentFolder = root;
  }

  function newComp(name, dur, folder, bgColor, w, h) {
    var c = app.project.items.addComp(name, w || W, h || H, 1, dur, CFG.fps);
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
      if (d.exists) return d;
    }
    return Folder.selectDialog("Pick the KVFX promo \"assets\" folder (Cancel builds with placeholders)");
  }

  // "anime/city.png" also finds anime/city.jpg or .jpeg.
  function assetFile(rel) {
    if (!ASSET_DIR) return null;
    var names = [rel];
    var dot = rel.lastIndexOf(".");
    if (dot > 0 && rel.substr(dot).toLowerCase() === ".png") {
      names.push(rel.substr(0, dot) + ".jpg");
      names.push(rel.substr(0, dot) + ".jpeg");
    }
    for (var i = 0; i < names.length; i++) {
      var f = new File(ASSET_DIR.fsName + "/" + names[i]);
      if (f.exists) return f;
    }
    return null;
  }

  function footage(rel) {
    if (FOOTAGE.hasOwnProperty(rel)) return FOOTAGE[rel];
    var item = null;
    var f = assetFile(rel);
    if (f) {
      try {
        var io = new ImportOptions(f);
        try {
          io.sequence = false;
        } catch (se) {
          // Not every file type has the option.
        }
        item = app.project.importFile(io);
        item.parentFolder = FOLDERS.assets;
      } catch (e) {
        warn("Could not import " + rel + ": " + errText(e));
        item = null;
      }
    }
    FOOTAGE[rel] = item;
    return item;
  }

  function placeholderSize(rel) {
    if (rel.indexOf("anime/") === 0) return [1125, 2000];
    if (rel.indexOf("ui/") === 0 || rel.indexOf("clips/") === 0) return [760, 1720];
    return [W, H];
  }

  // A still from assets/, or a named placeholder solid of the same size.
  function still(comp, rels, name) {
    var list = rels instanceof Array ? rels : [rels];
    for (var i = 0; i < list.length; i++) {
      var item = footage(list[i]);
      if (item) {
        var l = comp.layers.add(item);
        l.name = name || list[i];
        return l;
      }
    }
    var size = placeholderSize(list[0]);
    var ph = comp.layers.addSolid(C.missing, "MISSING " + list[0], size[0], size[1], 1);
    var seen = false;
    for (var m = 0; m < MISSING.length; m++) if (MISSING[m] === list[0]) seen = true;
    if (!seen) MISSING.push(list[0]);
    return ph;
  }

  function srcSize(l) {
    return l.source ? [l.source.width, l.source.height] : [W, H];
  }

  // Scale (%) at which a layer covers a w x h frame.
  function coverPct(l, extra, w, h) {
    var s = srcSize(l);
    return Math.max((w || W) / s[0], (h || H) / s[1]) * 100 * (extra || 1);
  }

  // Scale (%) that makes a layer the given height in pixels, whatever the
  // resolution of the file that was dropped in.
  function heightPct(l, px) {
    return px / srcSize(l)[1] * 100;
  }

  function place3D(l, pos, scalePct) {
    l.threeDLayer = true;
    setPos(l, pos);
    if (scalePct !== undefined) setScale(l, scalePct);
    return l;
  }

  // ---------------------------------------------------------------------------
  // Layers: nulls, solids, effects
  // ---------------------------------------------------------------------------

  function nul(comp, name, pos, threeD) {
    var l = comp.layers.addNull();
    l.name = name;
    l.label = 2;
    if (threeD) l.threeDLayer = true;
    tr(l, "ADBE Anchor Point").setValue(threeD ? [0, 0, 0] : [0, 0]);
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

  function fxProp(l, idx, p) {
    if (!idx) return null;
    return l.property("ADBE Effect Parade").property(idx).property(p);
  }

  function slider(l, name, v) {
    return fx(l, "ADBE Slider Control", name, [[1, v]]);
  }

  function gradBg(comp, top, bottom, name) {
    var l = solid(comp, top, name || "BG");
    fx(l, "ADBE Ramp", "Backdrop", [[1, [comp.width / 2, 0]], [2, rgba(top)], [3, [comp.width / 2, comp.height]], [4, rgba(bottom)]]);
    return l;
  }

  function flash(comp, t, col, frames, opacity) {
    var l = solid(comp, col || C.white, "Flash");
    l.blendingMode = BlendingMode.ADD;
    tr(l, "ADBE Opacity").setValue(opacity === undefined ? 85 : opacity);
    span(l, t, t + (frames || 2) * FD);
    return l;
  }

  function blurLayer(l, amount) {
    return fx(l, "ADBE Gaussian Blur 2", "Depth Blur", [[1, amount], [3, 1]]);
  }

  function glow(l, radius, intensity) {
    return fx(l, "ADBE Glo2", "Glow", [[3, radius], [4, intensity]]);
  }

  function dropShadow(l, distance, softness) {
    return fx(l, "ADBE Drop Shadow", "Shadow", [[2, 120], [4, distance], [5, softness]]);
  }

  // ---------------------------------------------------------------------------
  // Shapes
  // ---------------------------------------------------------------------------

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

  function paint(l, gi, fill, stroke, strokeWidth) {
    if (stroke) {
      var si = addItem(l, gi, "ADBE Vector Graphic - Stroke");
      gItem(l, gi, si).property("ADBE Vector Stroke Color").setValue(rgba(stroke));
      gItem(l, gi, si).property("ADBE Vector Stroke Width").setValue(strokeWidth || 4);
      try {
        gItem(l, gi, si).property("ADBE Vector Stroke Line Cap").setValue(2);
        gItem(l, gi, si).property("ADBE Vector Stroke Line Join").setValue(2);
      } catch (e) {
        // Round caps are cosmetic.
      }
    }
    if (fill) {
      var fi = addItem(l, gi, "ADBE Vector Graphic - Fill");
      gItem(l, gi, fi).property("ADBE Vector Fill Color").setValue(rgba(fill));
    }
  }

  function rectGroup(l, name, w, h, r, center, fill, stroke, strokeWidth) {
    var gi = addGroup(l, name);
    var ri = addItem(l, gi, "ADBE Vector Shape - Rect");
    gItem(l, gi, ri).property("ADBE Vector Rect Size").setValue([w, h]);
    gItem(l, gi, ri).property("ADBE Vector Rect Roundness").setValue(r || 0);
    if (center) gItem(l, gi, ri).property("ADBE Vector Rect Position").setValue(center);
    paint(l, gi, fill, stroke, strokeWidth);
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

  // Trim Paths on a group, animated from 0 to 100% between t0 and t1.
  function drawOn(l, gi, t0, t1) {
    try {
      var ti = addItem(l, gi, "ADBE Vector Filter - Trim");
      anim(gItem(l, gi, ti).property("ADBE Vector Trim End"), [[t0, 0], [t1, 100]], "snap");
    } catch (e) {
      warn("Trim paths on " + l.name + ": " + errText(e));
    }
  }

  function repeater(l, gi, copies, offset) {
    try {
      var ri = addItem(l, gi, "ADBE Vector Filter - Repeater");
      gItem(l, gi, ri).property("ADBE Vector Repeater Copies").setValue(copies);
      var t = gItem(l, gi, ri).property("ADBE Vector Repeater Transform");
      var p = null;
      try {
        p = t.property("ADBE Vector Repeater Position");
      } catch (e1) {
        p = null;
      }
      if (!p) p = t.property("Position");
      p.setValue(offset);
    } catch (e) {
      warn("Repeater on " + l.name + ": " + errText(e));
    }
  }

  // Rounded-rectangle mask path, used to round the corners of nested comps.
  function roundedMask(l, w, h, r, ox, oy) {
    try {
      var k = r * 0.5523;
      var x = ox || 0;
      var y = oy || 0;
      var s = new Shape();
      s.vertices = [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r], [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r]];
      s.inTangents = [[-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]];
      s.outTangents = [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]];
      s.closed = true;
      var mi = l.property("ADBE Mask Parade").addProperty("ADBE Mask Atom").propertyIndex;
      l.property("ADBE Mask Parade").property(mi).property("ADBE Mask Shape").setValue(s);
    } catch (e) {
      warn("Mask on " + l.name + ": " + errText(e));
    }
  }

  // Faint dot grid: one dot repeated across and then down.
  function dotGrid(comp, col, opacity) {
    var l = shape(comp, "Dot Grid");
    var gi = ellipseGroup(l, "dot", 6, [0, 0], col, null, 0);
    repeater(l, gi, Math.ceil(comp.width / 48) + 1, [48, 0]);
    repeater(l, gi, Math.ceil(comp.height / 48) + 1, [0, 48]);
    setPos(l, [24, 24]);
    tr(l, "ADBE Opacity").setValue(opacity);
    return l;
  }

  // The KVFX mark: an amber diamond with a dark core and a cream spark.
  function logoMark(comp, name, size, outer, inner) {
    var l = shape(comp, name);
    var spark = addGroup(l, "spark");
    var si = addItem(l, spark, "ADBE Vector Shape - Rect");
    gItem(l, spark, si).property("ADBE Vector Rect Size").setValue([size * 0.16, size * 0.16]);
    paint(l, spark, C.cream, null, 0);
    gXform(l, spark).property("ADBE Vector Position").setValue([size * 0.2, -size * 0.2]);
    gXform(l, spark).property("ADBE Vector Rotation").setValue(45);
    var core = rectGroup(l, "core", size * 0.4, size * 0.4, 0, null, inner || C.ink, null, 0);
    gXform(l, core).property("ADBE Vector Rotation").setValue(45);
    var body = rectGroup(l, "body", size, size, size * 0.06, null, outer || C.amber, null, 0);
    gXform(l, body).property("ADBE Vector Rotation").setValue(45);
    return l;
  }

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------

  var LEFT = ParagraphJustification.LEFT_JUSTIFY;
  var CENTER = ParagraphJustification.CENTER_JUSTIFY;

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
    if (mode === "topleft") a = [r.left, r.top];
    tr(l, "ADBE Anchor Point").setValue(a);
  }

  // o: font, size, color, fill (false = outline only), stroke, strokeWidth,
  //    strokeOver, tracking, just, leading, maxW, anchor, pos, name
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
    td.font = FONT[o.font || "display"];
    td.fontSize = o.size || 100;
    td.applyFill = o.fill !== false;
    if (td.applyFill) td.fillColor = o.color || C.cream;
    if (o.stroke) {
      td.applyStroke = true;
      td.strokeColor = o.stroke;
      td.strokeWidth = o.strokeWidth || 6;
      td.strokeOverFill = !!o.strokeOver;
    } else {
      td.applyStroke = false;
    }
    td.tracking = o.tracking || 0;
    td.justification = o.just || CENTER;
    if (o.leading) {
      try {
        td.autoLeading = false;
        td.leading = o.leading;
      } catch (e1) {
        // Leading is cosmetic.
      }
    }
    sp.setValue(td);
    l.name = cleanName(o.name || str);
    fitWidth(l, o.maxW || comp.width - 140);
    anchorTo(l, o.anchor || "center");
    if (o.pos) setPos(l, o.pos);
    return l;
  }

  // Adds an animator holding the given [matchName, value] properties and
  // returns a getter for it: references go stale after addProperty, so every
  // access re-resolves the animator by index.
  function textAnimator(l, name, props) {
    try {
      l.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
      var idx = l.property("ADBE Text Properties").property("ADBE Text Animators").numProperties;
      var getA = function () {
        return l.property("ADBE Text Properties").property("ADBE Text Animators").property(idx);
      };
      getA().name = name;
      for (var i = 0; i < props.length; i++) {
        getA().property("ADBE Text Animator Properties").addProperty(props[i][0]);
        getA().property("ADBE Text Animator Properties").property(props[i][0]).setValue(props[i][1]);
      }
      return getA;
    } catch (e) {
      warn("Text animator on " + l.name + ": " + errText(e));
      return null;
    }
  }

  function exprSelector(getA, amountExpr, basedOn) {
    try {
      getA().property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
      var n = getA().property("ADBE Text Selectors").numProperties;
      try {
        getA().property("ADBE Text Selectors").property(n).property("ADBE Text Range Type2").setValue(basedOn);
      } catch (e1) {
        // "Based On" defaults to characters, which is fine.
      }
      getA().property("ADBE Text Selectors").property(n).property("ADBE Text Expressible Amount").expression = amountExpr;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Characters (or words) arrive one after another. The animator holds the
  // "before" state; the selector releases each unit with a cubic ease-out.
  // o: stagger (s), dur (s), x, y, scale, rot, blur, words
  function charIn(l, t0, o) {
    o = o || {};
    var stagger = o.stagger === undefined ? 0.03 : o.stagger;
    var dur = o.dur || 0.45;
    var props = [["ADBE Text Opacity", 0]];
    var y = o.y === undefined ? 90 : o.y;
    var x = o.x || 0;
    if (y !== 0 || x !== 0) props.push(["ADBE Text Position 3D", [x, y, 0]]);
    if (o.scale !== undefined) props.push(["ADBE Text Scale 3D", [o.scale, o.scale, 100]]);
    if (o.rot) props.push(["ADBE Text Rotation", o.rot]);
    if (o.blur) props.push(["ADBE Text Blur", [o.blur, o.blur]]);
    var getA = textAnimator(l, "KV In", props);
    if (!getA) return;
    var amount = [
      "var d = " + stagger + " * (textIndex - 1);",
      "var t = (time - " + t0 + " - d) / " + dur + ";",
      "var k = 1 - Math.min(Math.max(t, 0), 1);",
      "var a = 100 * k * k * k;",
      "[a, a, a];"
    ].join("\n");
    if (exprSelector(getA, amount, o.words ? 3 : 2)) return;
    // Fallback: a range selector whose ramp sweeps across the text.
    try {
      getA().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
      var sel = function () {
        return getA().property("ADBE Text Selectors").property(1);
      };
      try {
        sel().property("ADBE Text Range Advanced").property("ADBE Text Range Shape").setValue(2);
      } catch (e1) {
        // Square shape still reveals, just less smoothly.
      }
      var units = textDoc(l).value.text.length;
      anim(sel().property("ADBE Text Percent Offset"), [[t0, -100], [t0 + dur + stagger * units, 100]], "snap");
    } catch (e2) {
      warn("Text reveal on " + l.name + " fell back to a fade: " + errText(e2));
      try {
        getA().remove();
      } catch (e3) {
        // Nothing left to clean up.
      }
      anim(tr(l, "ADBE Opacity"), [[t0, 0], [t0 + dur, 100]], "snap");
    }
  }

  // Letters blow apart: each one gets its own random direction and spin.
  function charScatter(l, t0, dur, reach) {
    var r = reach || [700, -1100, 900];
    var getA = textAnimator(l, "KV Scatter", [
      ["ADBE Text Position 3D", r],
      ["ADBE Text Rotation", 540],
      ["ADBE Text Blur", [24, 24]]
    ]);
    if (!getA) return;
    var amount = [
      "seedRandom(textIndex, true);",
      "var delay = random(0, 0.12);",
      "var p = Math.min(Math.max((time - " + t0 + " - delay) / " + dur + ", 0), 1);",
      "var e = p * p;",
      "[random(-100, 100) * e, random(25, 100) * e, random(-100, 100) * e];"
    ].join("\n");
    if (!exprSelector(getA, amount, 2)) {
      try {
        getA().remove();
      } catch (e) {
        // Nothing to remove.
      }
    }
    anim(tr(l, "ADBE Opacity"), [[t0 + dur * 0.4, 100], [t0 + dur, 0]], "accel");
  }

  // ---------------------------------------------------------------------------
  // Camera rig: a 3D null carrying a one-node camera, with shake sliders.
  // ---------------------------------------------------------------------------

  function camRig(comp, name, t0, t1) {
    var cx = comp.width / 2;
    var cy = comp.height / 2;
    var rig = nul(comp, name + " Rig", [cx, cy, 0], true);
    var amt = slider(rig, "Shake Amount", 0);
    slider(rig, "Shake Speed", 4);
    var cam = comp.layers.addCamera(name, [cx, cy]);
    try {
      cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
    } catch (e) {
      // A two-node camera works too, it just ignores rig rotation.
    }
    try {
      cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").setValue(CFG.zoom);
    } catch (e1) {
      warn("Camera zoom on " + name + ": " + errText(e1));
    }
    cam.parent = rig;
    setPos(cam, [0, 0, -CFG.zoom]);
    var ref = "thisComp.layer(\"" + rig.name + "\")";
    expr(tr(cam, "ADBE Position"), [
      "var r = " + ref + ";",
      "var w = wiggle(r.effect(\"Shake Speed\")(1), r.effect(\"Shake Amount\")(1));",
      "[w[0], w[1], value[2]];"
    ].join("\n"));
    expr(tr(cam, "ADBE Rotate Z"), [
      "var r = " + ref + ";",
      "wiggle(r.effect(\"Shake Speed\")(1), r.effect(\"Shake Amount\")(1) * 0.04);"
    ].join("\n"));
    if (t0 !== undefined) {
      span(rig, t0, t1);
      span(cam, t0, t1);
    }
    return { layer: rig, cam: cam, amt: amt };
  }

  function shakeBase(rig, v) {
    var p = fxProp(rig.layer, rig.amt, 1);
    if (p) p.setValue(v);
  }

  function shakeHit(rig, t, amount, base) {
    anim(fxProp(rig.layer, rig.amt, 1), [[t, base], [t + FD, amount], [t + 10 * FD, base]], "snap");
  }

  // ---------------------------------------------------------------------------
  // Callouts: neo-brutalist chips that name the panel feature on screen.
  // ---------------------------------------------------------------------------

  // o: tab, title, sub, t0, t1, x, y, align ("left" | "center"), rot, scale,
  //    theme ("cream" | "ink" | "amber")
  function chip(comp, o) {
    var theme = o.theme || "cream";
    var fill = theme === "ink" ? C.ink : theme === "amber" ? C.amber : C.cream;
    var ink = theme === "ink" ? C.cream : C.ink;
    var tabCol = theme === "amber" ? C.ink : C.amberDeep;
    if (theme === "ink") tabCol = C.amber;
    var shadowCol = theme === "cream" ? C.amber : theme === "ink" ? C.amber : C.ink;
    var padX = 30;
    var padY = 24;
    var gap = 10;

    var tabL = txt(comp, o.tab.toUpperCase(), { font: "mono", size: 24, color: tabCol, just: LEFT, tracking: 60, anchor: "topleft" });
    var titleL = txt(comp, o.title.toUpperCase(), { font: "ui", size: 54, color: ink, just: LEFT, tracking: 10, anchor: "topleft" });
    var subL = txt(comp, o.sub, { font: "body", size: 30, color: ink, just: LEFT, anchor: "topleft" });
    var rt = rect0(tabL);
    var r1 = rect0(titleL);
    var r2 = rect0(subL);
    var bw = Math.max(rt.width, Math.max(r1.width, r2.width)) + padX * 2;
    var bh = padY * 2 + rt.height + r1.height + r2.height + gap * 2 + 8;

    var box = shape(comp, "Chip box");
    rectGroup(box, "card", bw, bh, 22, [bw / 2, bh / 2], fill, C.ink, 5);
    rectGroup(box, "hard shadow", bw, bh, 22, [bw / 2 + 10, bh / 2 + 10], shadowCol, C.ink, 5);
    box.moveAfter(tabL);

    var ax = o.align === "center" ? o.x : o.x + bw / 2;
    var holder = nul(comp, "Chip \u00B7 " + o.title, [ax, o.y + bh / 2]);
    tr(holder, "ADBE Anchor Point").setValue([bw / 2, bh / 2]);
    holder.label = 11;
    var parts = [box, tabL, titleL, subL];
    parentAll(parts, holder);
    setPos(box, [0, 0]);
    setPos(tabL, [padX, padY]);
    setPos(titleL, [padX, padY + rt.height + gap]);
    setPos(subL, [padX, padY + rt.height + r1.height + gap * 2 + 4]);
    parts.push(holder);
    spanAll(parts, o.t0, o.t1);

    var s = o.scale || 100;
    popIn(holder, o.t0, s);
    popOut(holder, o.t1, s);
    var rot = o.rot === undefined ? -3 : o.rot;
    anim(tr(holder, "ADBE Rotate Z"), [[o.t0, rot - 12], [o.t0 + 12 * FD, rot]], "snap");
    return holder;
  }

  // One-line sticker pill.
  function pill(comp, str, o) {
    var fill = o.fill || C.cream;
    var inkC = o.ink || C.ink;
    var t = txt(comp, str, { font: o.font || "ui", size: o.size || 40, color: inkC, tracking: o.tracking || 0 });
    var r = rect0(t);
    var bw = r.width + (o.padX || 36) * 2;
    var bh = r.height + (o.padY || 22) * 2;
    var box = shape(comp, "Pill box");
    rectGroup(box, "pill", bw, bh, bh / 2, [0, 0], fill, o.stroke === false ? null : C.ink, 5);
    if (o.shadow) rectGroup(box, "hard shadow", bw, bh, bh / 2, [8, 8], o.shadow, C.ink, 5);
    box.moveAfter(t);
    var holder = nul(comp, "Pill \u00B7 " + str, o.pos);
    if (o.threeD) {
      holder.threeDLayer = true;
      box.threeDLayer = true;
      t.threeDLayer = true;
      if (o.pos.length < 3) setPos(holder, [o.pos[0], o.pos[1], 0]);
    }
    parentAll([box, t], holder);
    setPos(box, o.threeD ? [0, 0, 0] : [0, 0]);
    setPos(t, o.threeD ? [0, 0, 0] : [0, 0]);
    spanAll([box, t, holder], o.t0, o.t1);
    tr(holder, "ADBE Rotate Z").setValue(o.rot || 0);
    if (o.t0 !== undefined) popIn(holder, o.t0, 100);
    return holder;
  }

  // The real panel sliding in, framed like a device: a recording when o.clip
  // names one (starting o.from seconds in), else the screenshot of tab `file`.
  function panelCard(comp, file, o) {
    var l = o.clip ? panelClip(comp, o.clip, file, o.t0, o.t1, o.from) : still(comp, "ui/" + file + ".png", "Panel \u00B7 " + file);
    var s = o.scale || 44;
    var size = srcSize(l);
    var bezel = shape(comp, "Panel bezel");
    rectGroup(bezel, "bezel", size[0] + 44, size[1] + 44, 56, [0, 0], C.ink2, C.amber, 4);
    bezel.moveAfter(l);
    bezel.parent = l;
    setPos(bezel, [size[0] / 2, size[1] / 2]);
    setScale(l, s);
    dropShadow(l, 30, 90);
    var x = o.x === undefined ? W - 200 : o.x;
    var y = o.y === undefined ? CY : o.y;
    anim(tr(l, "ADBE Position"), [[o.t0, [x + 700, y]], [o.t0 + 0.35, [x, y]]], "snap");
    anim(tr(l, "ADBE Position"), [[o.t1 - 0.25, [x, y]], [o.t1, [x + 800, y]]], "accel");
    anim(tr(l, "ADBE Rotate Z"), [[o.t0, 12], [o.t0 + 0.45, o.rot === undefined ? -5 : o.rot]], "snap");
    l.motionBlur = true;
    spanAll([l, bezel], o.t0, o.t1);
    return l;
  }

  function chapter(comp, num, label, t0, t1, col) {
    var l = txt(comp, num + "  /  " + label, { font: "mono", size: 28, color: col || C.amber, just: LEFT, tracking: 120, anchor: "left", pos: [76, 250] });
    span(l, t0, t1);
    charIn(l, t0 + 0.05, { stagger: 0.012, dur: 0.2, y: 0 });
    return l;
  }

  // Section opener: huge outlined number, title and tags, then a whip up.
  function titleCard(comp, num, title, tags, t0, t1, light) {
    var inkC = light ? C.ink : C.cream;
    var n = txt(comp, num, { font: "display", size: 560, fill: false, stroke: C.amber, strokeWidth: 5, pos: [CX, CY - 300] });
    var t = txt(comp, title, { font: "display", size: 130, color: inkC, maxW: W - 140, pos: [CX, CY + 80] });
    var g = txt(comp, tags, { font: "mono", size: 30, color: light ? C.amberDeep : C.amber, tracking: 120, pos: [CX, CY + 230] });
    var holder = nul(comp, "Title " + num, [CX, CY]);
    var parts = [n, t, g];
    parentAll(parts, holder);
    parts.push(holder);
    spanAll(parts, t0, t1);
    anim(tr(n, "ADBE Scale"), [[t0, [150, 150, 150]], [t0 + 0.45, [100, 100, 100]]], "snap");
    anim(tr(n, "ADBE Opacity"), [[t0, 0], [t0 + 3 * FD, 100]], "linear");
    charIn(t, t0 + 0.08, { stagger: 0.03, dur: 0.4, y: 140, blur: 14 });
    charIn(g, t0 + 0.3, { stagger: 0.012, dur: 0.18, y: 0 });
    anim(tr(holder, "ADBE Position"), [[t1 - 0.22, [CX, CY]], [t1, [CX, CY - 2400]]], "accel");
    for (var i = 0; i < parts.length; i++) parts[i].motionBlur = true;
    return holder;
  }

  // x, y are relative to parentL when one is given. Parenting happens before
  // any keyframe is set, so nothing has to be compensated afterwards.
  function keycap(comp, label, x, y, w, tPress, parentL) {
    var t = txt(comp, label, { font: "mono", size: 46, color: C.ink });
    var box = shape(comp, "Key " + label);
    rectGroup(box, "top", w, 120, 22, [0, 0], C.cream, C.ink, 5);
    rectGroup(box, "side", w, 120, 22, [0, 14], C.amber, C.ink, 5);
    box.moveAfter(t);
    var holder = nul(comp, "Keycap " + label, [x, y]);
    if (parentL) holder.parent = parentL;
    setPos(holder, [x, y]);
    parentAll([box, t], holder);
    setPos(box, [0, 0]);
    setPos(t, [0, 0]);
    anim(tr(holder, "ADBE Position"), [[tPress, [x, y]], [tPress + 3 * FD, [x, y + 12]], [tPress + 9 * FD, [x, y]]], "snap");
    return [holder, box, t];
  }

  // ---------------------------------------------------------------------------
  // Effects used across scenes
  // ---------------------------------------------------------------------------

  function rain(comp, t0, t1) {
    var l = solid(comp, C.ink, "Rain");
    if (!fx(l, "CSRainfall", "Rain")) {
      l.remove();
      return null;
    }
    l.blendingMode = BlendingMode.SCREEN;
    tr(l, "ADBE Opacity").setValue(70);
    span(l, t0, t1);
    return l;
  }

  // Red/cyan ghost copies that snap back together: a chromatic glitch built
  // only from Tint, so it never depends on channel-menu values.
  function chroma(comp, l, t0, t1, offset) {
    var base = tr(l, "ADBE Position").value;
    var copies = [[C.red, offset], [C.cyan, -offset]];
    for (var i = 0; i < copies.length; i++) {
      var c = l.duplicate();
      c.name = l.name + (i === 0 ? " (red)" : " (cyan)");
      fx(c, "ADBE Tint", "Channel", [[1, rgba(C.ink)], [2, rgba(copies[i][0])], [3, 100]]);
      c.blendingMode = BlendingMode.SCREEN;
      tr(c, "ADBE Opacity").setValue(55);
      var dx = copies[i][1];
      anim(tr(c, "ADBE Position"), [[t0, [base[0] + dx, base[1], base[2]]], [t0 + 0.4, [base[0] + dx * 0.15, base[1], base[2]]]], "snap");
      anim(tr(c, "ADBE Opacity"), [[t1 - 0.2, 55], [t1, 0]], "smooth");
      span(c, t0, t1);
    }
  }

  // Radial speed lines: one thin bar repeated around a circle.
  function speedLines(comp, name, col) {
    var l = shape(comp, name);
    var gi = rectGroup(l, "line", 10, 900, 5, [0, -1150], col, null, 0);
    try {
      var ri = addItem(l, gi, "ADBE Vector Filter - Repeater");
      gItem(l, gi, ri).property("ADBE Vector Repeater Copies").setValue(36);
      var t = gItem(l, gi, ri).property("ADBE Vector Repeater Transform");
      var pos = null;
      try {
        pos = t.property("ADBE Vector Repeater Position");
      } catch (e0) {
        pos = null;
      }
      if (!pos) pos = t.property("Position");
      pos.setValue([0, 0]);
      var rot = null;
      try {
        rot = t.property("ADBE Vector Repeater Rotation");
      } catch (e1) {
        rot = null;
      }
      if (!rot) rot = t.property("Rotation");
      rot.setValue(10);
    } catch (e) {
      warn("Speed lines: " + errText(e));
    }
    expr(tr(l, "ADBE Rotate Z"), "time * 25;");
    return l;
  }

  function elasticExpression() {
    return [
      "// KVFX Tools - elastic",
      "var amplitude = 0.05;",
      "var frequency = 3;",
      "var decay = 6;",
      "function kvAdd(a, b) {",
      "  if (a instanceof Array) { var r = []; for (var i = 0; i < a.length; i++) r[i] = a[i] + b[i]; return r; }",
      "  return a + b;",
      "}",
      "function kvScale(a, s) {",
      "  if (a instanceof Array) { var r = []; for (var i = 0; i < a.length; i++) r[i] = a[i] * s; return r; }",
      "  return a * s;",
      "}",
      "var kvN = 0;",
      "if (numKeys > 0) {",
      "  kvN = nearestKey(time).index;",
      "  if (key(kvN).time > time) kvN--;",
      "}",
      "var kvResult = value;",
      "if (kvN > 0) {",
      "  var kvT = time - key(kvN).time;",
      "  if (kvT > 0) {",
      "    var kvV = velocityAtTime(key(kvN).time - thisComp.frameDuration / 10);",
      "    var kvW = amplitude * Math.sin(frequency * kvT * 2 * Math.PI) / Math.exp(decay * kvT);",
      "    kvResult = kvAdd(value, kvScale(kvV, kvW));",
      "  }",
      "}",
      "kvResult;"
    ].join("\n");
  }

  function counterExpression(to, prefix, suffix) {
    return [
      "// KVFX Tools - counter",
      "var p = clamp(effect(\"KVFX Counter\")(1) / 100, 0, 1);",
      "var v = Math.round(" + to + " * p);",
      "var s = String(v).replace(/\\B(?=(\\d{3})+(?!\\d))/g, \",\");",
      "\"" + prefix + "\" + s + \"" + suffix + "\";"
    ].join("\n");
  }

  // Gradient Ramp ends that follow the text's own bounds every frame.
  function gradientLock(l, from, to) {
    var idx = fx(l, "ADBE Ramp", "KVFX Gradient Lock", [[2, rgba(from)], [4, rgba(to)]]);
    if (!idx) return;
    expr(fxProp(l, idx, 1), "var r = sourceRectAtTime(time, false);\n[r.left, r.top + r.height / 2];");
    expr(fxProp(l, idx, 3), "var r = sourceRectAtTime(time, false);\n[r.left + r.width, r.top + r.height / 2];");
  }

  // A soft glow that fills the frame. It is a radial Gradient Ramp added over
  // the scene, so unlike a blurred shape it has no edge to crop.
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

  // A recording of the panel (assets/clips/<name>.mp4) that starts playing at
  // t0 from `from` seconds in, and holds its last frame if the shot runs on.
  // Without the recording, the screenshot ui/<tab>.png stands in.
  function panelClip(comp, name, tab, t0, t1, from) {
    var item = footage("clips/" + name + ".mp4");
    if (!item) {
      var still0 = still(comp, "ui/" + tab + ".png", "Panel \u00B7 " + tab);
      span(still0, t0, t1);
      return still0;
    }
    var start = from || 0;
    var l = comp.layers.add(item);
    l.name = "Panel clip \u00B7 " + name;
    l.startTime = t0 - start;
    try {
      if (l.canSetTimeRemapEnabled) {
        l.timeRemapEnabled = true;
        expr(l.property("ADBE Time Remapping"), "Math.min(Math.max(time - " + t0 + " + " + start + ", 0), " + Math.max(0, item.duration - FD) + ");");
      }
    } catch (e) {
      warn("Time remap on " + l.name + ": " + errText(e));
    }
    try {
      span(l, t0, t1);
    } catch (e2) {
      span(l, t0, Math.min(t1, l.startTime + item.duration));
    }
    return l;
  }

  // The panel as a floating device: recording, bezel and shadow.
  // o: clip, tab, from, t0, t1, pos, scale, threeD, rotX, rotY, rotZ, pop
  function deviceCard(comp, o) {
    var l = panelClip(comp, o.clip, o.tab || o.clip, o.t0, o.t1, o.from);
    var size = srcSize(l);
    var bezel = shape(comp, "Panel bezel");
    rectGroup(bezel, "bezel", size[0] + 44, size[1] + 44, 56, [0, 0], C.ink2, C.amber, 5);
    bezel.moveAfter(l);
    if (o.threeD) {
      l.threeDLayer = true;
      bezel.threeDLayer = true;
    }
    bezel.parent = l;
    setPos(bezel, o.threeD ? [size[0] / 2, size[1] / 2, 6] : [size[0] / 2, size[1] / 2]);
    dropShadow(l, 40, 110);
    setScale(l, o.scale);
    setPos(l, o.pos);
    if (o.threeD) {
      tr(l, "ADBE Rotate X").setValue(o.rotX || 0);
      tr(l, "ADBE Rotate Y").setValue(o.rotY || 0);
    }
    tr(l, "ADBE Rotate Z").setValue(o.rotZ || 0);
    if (o.pop) popIn(l, o.t0, o.scale);
    span(bezel, o.t0, o.t1);
    return l;
  }

  // A magnified window onto part of a recording. region is [x, y, w, h] in
  // the recording's pixels; it is shown `zoom` times larger, centred on pos.
  function zoomInset(comp, o) {
    var r = o.region;
    var w = r[2] * o.zoom;
    var h = r[3] * o.zoom;
    var back = shape(comp, "Inset back");
    rectGroup(back, "panel", w + 20, h + 20, 30, [0, 0], C.ink2, null, 0);
    rectGroup(back, "hard shadow", w + 20, h + 20, 30, [14, 14], C.amber, C.ink, 5);
    var l = panelClip(comp, o.clip, o.tab || o.clip, o.t0, o.t1, o.from);
    roundedMask(l, r[2], r[3], 14, r[0], r[1]);
    tr(l, "ADBE Anchor Point").setValue([r[0] + r[2] / 2, r[1] + r[3] / 2]);
    setScale(l, o.zoom * 100);
    var frame = shape(comp, "Inset frame");
    rectGroup(frame, "frame", w + 20, h + 20, 30, [0, 0], null, C.ink, 6);
    var holder = nul(comp, "Zoom \u00B7 " + o.clip, o.pos);
    parentAll([back, l, frame], holder);
    setPos(back, [0, 0]);
    setPos(l, [0, 0]);
    setPos(frame, [0, 0]);
    tr(holder, "ADBE Rotate Z").setValue(o.rot || 0);
    popIn(holder, o.t0, 100);
    popOut(holder, o.t1, 100);
    spanAll([back, frame, holder], o.t0, o.t1);
    return holder;
  }

  // ---------------------------------------------------------------------------
  // Graph editor: the curve being dragged in the Ease tab, drawn big. A driver
  // null loops a playhead across it, solves the bezier from the curve's own
  // path every frame, and moves a ball by the result - so what you see is
  // exactly the motion the curve makes.
  // ---------------------------------------------------------------------------

  function bezierShape(b, gw, gh) {
    var s = new Shape();
    s.vertices = [[-gw / 2, gh / 2], [gw / 2, -gh / 2]];
    s.outTangents = [[b[0] * gw, -b[1] * gh], [0, 0]];
    s.inTangents = [[0, 0], [(b[2] - 1) * gw, (1 - b[3]) * gh]];
    s.closed = false;
    return s;
  }

  function armShape(b, gw, gh, second) {
    var s = new Shape();
    if (second) s.vertices = [[gw / 2, -gh / 2], [(b[2] - 0.5) * gw, (0.5 - b[3]) * gh]];
    else s.vertices = [[-gw / 2, gh / 2], [(b[0] - 0.5) * gw, (0.5 - b[1]) * gh]];
    s.closed = false;
    return s;
  }

  // o: x, y (card centre), t0, t1, keys: [[time, [x1, y1, x2, y2], label], ...]
  function graphEditor(comp, o) {
    var gw = 720;
    var gh = 340;
    var px = o.x;
    var py = o.y - 30;
    var made = [];

    var card = shape(comp, "Graph card");
    rectGroup(card, "card", 900, 620, 36, [0, 0], C.ink2, C.ink3, 4);
    rectGroup(card, "hard shadow", 900, 620, 36, [14, 14], C.amber, C.ink, 5);
    for (var g = 0; g <= 4; g++) {
      pathGroup(card, "grid v" + g, [[-gw / 2 + g * gw / 4, -gh / 2 - 30], [-gw / 2 + g * gw / 4, gh / 2 + 30]], false, null, C.ink3, 2);
      pathGroup(card, "grid h" + g, [[-gw / 2 - 30, -gh / 2 + g * gh / 4], [gw / 2 + 30, -gh / 2 + g * gh / 4]], false, null, C.ink3, 2);
    }
    pathGroup(card, "track", [[-gw / 2, gh / 2 + 120], [gw / 2, gh / 2 + 120]], false, null, C.ink3, 6);
    setPos(card, [px, py]);
    made.push(card);

    var title = txt(comp, "GRAPH EDITOR", { font: "mono", size: 22, color: C.mute, just: LEFT, anchor: "left", tracking: 120, pos: [o.x - 410, o.y - 270] });
    made.push(title);

    var curve = shape(comp, "Graph curve");
    var ci = pathGroup(curve, "curve", [[-gw / 2, gh / 2], [gw / 2, -gh / 2]], false, null, C.amber, 9);
    setPos(curve, [px, py]);
    glow(curve, 30, 0.8);
    made.push(curve);
    var arms = shape(comp, "Graph handles");
    var a1 = pathGroup(arms, "arm out", [[0, 0], [1, 1]], false, null, C.mute, 3);
    var a2 = pathGroup(arms, "arm in", [[0, 0], [1, 1]], false, null, C.mute, 3);
    var d1 = ellipseGroup(arms, "handle out", 24, [0, 0], C.cream, C.ink, 4);
    var d2 = ellipseGroup(arms, "handle in", 24, [0, 0], C.cream, C.ink, 4);
    var k1 = rectGroup(arms, "key start", 26, 26, 0, [0, 0], C.amber, C.ink, 4);
    var k2 = rectGroup(arms, "key end", 26, 26, 0, [0, 0], C.amber, C.ink, 4);
    gXform(arms, k1).property("ADBE Vector Position").setValue([-gw / 2, gh / 2]);
    gXform(arms, k1).property("ADBE Vector Rotation").setValue(45);
    gXform(arms, k2).property("ADBE Vector Position").setValue([gw / 2, -gh / 2]);
    gXform(arms, k2).property("ADBE Vector Rotation").setValue(45);
    setPos(arms, [px, py]);
    made.push(arms);

    // Morph everything through the curves, in step with the recording.
    var curveKeys = [];
    var arm1Keys = [];
    var arm2Keys = [];
    var dot1Keys = [];
    var dot2Keys = [];
    for (var i = 0; i < o.keys.length; i++) {
      var t = o.keys[i][0];
      var b = o.keys[i][1];
      curveKeys.push([t, bezierShape(b, gw, gh)]);
      arm1Keys.push([t, armShape(b, gw, gh, false)]);
      arm2Keys.push([t, armShape(b, gw, gh, true)]);
      dot1Keys.push([t, [(b[0] - 0.5) * gw, (0.5 - b[1]) * gh]]);
      dot2Keys.push([t, [(b[2] - 0.5) * gw, (0.5 - b[3]) * gh]]);
    }
    anim(gItem(curve, ci, 1).property("ADBE Vector Shape"), curveKeys, "smooth");
    anim(gItem(arms, a1, 1).property("ADBE Vector Shape"), arm1Keys, "smooth");
    anim(gItem(arms, a2, 1).property("ADBE Vector Shape"), arm2Keys, "smooth");
    anim(gXform(arms, d1).property("ADBE Vector Position"), dot1Keys, "smooth");
    anim(gXform(arms, d2).property("ADBE Vector Position"), dot2Keys, "smooth");

    // Driver: Phase loops 0 -> 1, Value is the curve solved at that phase.
    var driver = nul(comp, "Graph driver", [px, py]);
    var phaseIdx = slider(driver, "Phase", 0);
    var valueIdx = slider(driver, "Value", 0);
    expr(fxProp(driver, phaseIdx, 1), "var p = ((time - " + o.t0 + ") % 1.3) / 1.0;\nMath.min(Math.max(p, 0), 1);");
    expr(fxProp(driver, valueIdx, 1), [
      "var L = thisComp.layer(\"Graph curve\");",
      "var P = L.content(\"curve\").content(1).path;",
      "var o = P.outTangents()[0];",
      "var n = P.inTangents()[1];",
      "var gw = " + gw + ";",
      "var gh = " + gh + ";",
      "var x1 = o[0] / gw, y1 = -o[1] / gh, x2 = 1 + n[0] / gw, y2 = 1 - n[1] / gh;",
      "var t = effect(\"Phase\")(1);",
      "function bx(s) { return 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s; }",
      "function by(s) { return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s; }",
      "var lo = 0, hi = 1, s = t;",
      "for (var k = 0; k < 24; k++) { if (bx(s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }",
      "by(s);"
    ].join("\n"));
    made.push(driver);

    // These three are parented to the group null below, so their expressions
    // return positions relative to it: the plot centre sits at (0, -30).
    var ref = "thisComp.layer(\"Graph driver\")";
    var left = -gw / 2;
    var mid = py - o.y;
    var head = shape(comp, "Playhead");
    rectGroup(head, "line", 4, gh + 70, 2, [0, 0], C.cream, null, 0);
    tr(head, "ADBE Opacity").setValue(55);
    expr(tr(head, "ADBE Position"), "var d = " + ref + ";\n[" + left + " + d.effect(\"Phase\")(1) * " + gw + ", " + mid + "];");
    made.push(head);
    var tracer = shape(comp, "Tracer");
    ellipseGroup(tracer, "dot", 30, [0, 0], C.amber, C.cream, 5);
    expr(tr(tracer, "ADBE Position"), "var d = " + ref + ";\n[" + left + " + d.effect(\"Phase\")(1) * " + gw + ", " + (mid + gh / 2) + " - d.effect(\"Value\")(1) * " + gh + "];");
    made.push(tracer);
    var ball = shape(comp, "Ball");
    ellipseGroup(ball, "ball", 64, [0, 0], C.amber, C.ink, 6);
    expr(tr(ball, "ADBE Position"), "var d = " + ref + ";\n[" + left + " + d.effect(\"Value\")(1) * " + gw + ", " + (mid + gh / 2 + 120) + "];");
    made.push(ball);

    // Curve name, swapped as the curve changes.
    for (var j = 0; j < o.keys.length; j++) {
      if (!o.keys[j][2]) continue;
      var until = o.t1;
      for (var q = j + 1; q < o.keys.length; q++) {
        if (o.keys[q][2]) {
          until = o.keys[q][0];
          break;
        }
      }
      var label = txt(comp, o.keys[j][2], { font: "mono", size: 26, color: C.amber, tracking: 80, just: CENTER, pos: [o.x + 300, o.y - 270] });
      span(label, Math.max(o.t0, o.keys[j][0]), until);
      made.push(label);
    }

    var group = nul(comp, "Graph editor", [o.x, o.y]);
    parentAll(made, group);
    popIn(group, o.t0, 100);
    popOut(group, o.t1, 100);
    made.push(group);
    spanAll(made, o.t0, o.t1);
    return group;
  }

  // The ten Text tab presets, one per beat, each word animating as itself.
  var REEL = [
    ["TYPEWRITER", { stagger: 0.035, dur: 0.01, y: 0 }],
    ["FADE IN", { stagger: 0.03, dur: 0.3, y: 0 }],
    ["RISE", { stagger: 0.05, dur: 0.3, y: 140 }],
    ["DROP", { stagger: 0.05, dur: 0.3, y: -160 }],
    ["SLIDE", { stagger: 0.04, dur: 0.3, x: 200, y: 0 }],
    ["POP", { stagger: 0.06, dur: 0.3, scale: 0, y: 0 }],
    ["BLUR IN", { stagger: 0.03, dur: 0.35, blur: 50, y: 0 }],
    ["SPIN", { stagger: 0.05, dur: 0.35, rot: -180, scale: 0, y: 0 }],
    ["TRACK IN", { track: 600 }],
    ["ZOOM OUT", { stagger: 0.03, dur: 0.3, scale: 420, y: 0 }]
  ];

  function textReel(comp, t0, slot, y) {
    for (var i = 0; i < REEL.length; i++) {
      var a = t0 + i * slot;
      var word = txt(comp, REEL[i][0], { font: "display", size: 150, color: i % 3 === 2 ? C.amber : C.cream, maxW: 940, pos: [CX, y] });
      word.motionBlur = true;
      span(word, a, a + slot);
      if (REEL[i][1].track) {
        var getT = textAnimator(word, "KV Track In", [["ADBE Text Tracking Amount", 0]]);
        if (getT) {
          try {
            getT().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
            anim(getT().property("ADBE Text Animator Properties").property("ADBE Text Tracking Amount"), [[a, REEL[i][1].track], [a + 0.3, 0]], "snap");
          } catch (e) {
            warn("Track In reel word: " + errText(e));
          }
        }
        anim(tr(word, "ADBE Opacity"), [[a, 0], [a + 0.1, 100]], "linear");
      } else {
        charIn(word, a + 0.02, REEL[i][1]);
      }
      var n = txt(comp, (i < 9 ? "0" : "") + (i + 1) + " / 10  \u00B7  TEXT PRESET", { font: "mono", size: 26, color: C.amber, tracking: 80, pos: [CX, y - 130] });
      span(n, a, a + slot);
    }
  }

  // ---------------------------------------------------------------------------
  // Scene 01 - Hook
  // ---------------------------------------------------------------------------

  function buildHook(comp) {
    gradBg(comp, hex("#15171D"), C.ink);
    dotGrid(comp, C.cream, 6);
    radialGlow(comp, [CX, 1300], 900, C.amber, 40, "Amber glow");
    var rig = camRig(comp, "CAM Hook");
    anim(tr(rig.layer, "ADBE Position"), [[0, [CX, CY, -80]], [comp.duration, [CX, CY, 220]]], "smooth");
    anim(tr(rig.layer, "ADBE Rotate Y"), [[0, -6], [comp.duration, 4]], "smooth");
    shakeBase(rig, 2);

    // Frame one is already busy: two recordings of the panel, mid-action.
    var back = deviceCard(comp, { clip: "tools", from: 0.45, t0: 0, t1: comp.duration, pos: [CX - 250, 1440, 420], scale: 50, threeD: true, rotX: 10, rotY: 24, rotZ: -5 });
    tr(back, "ADBE Opacity").setValue(80);
    anim(tr(back, "ADBE Position"), [[0, [CX - 250, 1440, 420]], [comp.duration, [CX - 250, 1340, 420]]], "smooth");
    var front = deviceCard(comp, { clip: "ease", from: 0.45, t0: 0, t1: comp.duration, pos: [CX + 190, 1400, 0], scale: 56, threeD: true, rotX: 10, rotY: -18, rotZ: 4 });
    anim(tr(front, "ADBE Position"), [[0, [CX + 190, 1400, 0]], [comp.duration, [CX + 190, 1300, 0]]], "smooth");

    var pov = txt(comp, "POV:", { font: "mono", size: 46, color: C.amber, tracking: 80 });
    var l1 = txt(comp, "you found the", { font: "ui", size: 86, color: C.cream });
    var l2 = txt(comp, "AFTER EFFECTS", { font: "display", size: 150, color: C.cream, maxW: 940 });
    var l3 = txt(comp, "CHEAT CODE", { font: "display", size: 170, color: C.amber, maxW: 940, stroke: C.ink, strokeWidth: 10 });
    var lines = [[pov, 330], [l1, 440], [l2, 600], [l3, 790]];
    for (var i = 0; i < lines.length; i++) {
      lines[i][0].threeDLayer = true;
      lines[i][0].motionBlur = true;
      // In front of the panels, so the camera moves the type too.
      setPos(lines[i][0], [CX, lines[i][1], -120]);
    }
    // The first two lines are already on screen at frame one.
    charIn(pov, -0.4, { stagger: 0.04, dur: 0.15, y: 0 });
    charIn(l1, -0.1, { words: true, stagger: 0.08, dur: 0.3, y: 70, blur: 10 });
    slam(l2, 0.35, 180);
    slam(l3, 0.75, 210);
    shakeHit(rig, 0.37, 30, 2);
    shakeHit(rig, 0.79, 55, 2);
    anim(tr(l3, "ADBE Rotate Z"), [[0.75, -8], [1.05, -2]], "snap");
    flash(comp, 0.75, C.white, 2, 70);

    pill(comp, "(not a preset pack)", { pos: [CX + 150, 940], rot: -5, size: 40, font: "body", t0: 1.4, shadow: C.amber });
  }

  // ---------------------------------------------------------------------------
  // Scene 02 - Brand sting
  // ---------------------------------------------------------------------------

  function buildBrand(comp) {
    solid(comp, C.ink, "BG");
    radialGlow(comp, [CX, 820], 820, C.amber, 45, "Amber glow");

    var rig = camRig(comp, "CAM Brand");
    anim(tr(rig.layer, "ADBE Position"), [[0, [CX, CY, -420]], [1.0, [CX, CY, 0]]], "snap");
    anim(tr(rig.layer, "ADBE Position"), [[1.0, [CX, CY, 0]], [comp.duration, [CX, CY, 70]]], "smooth");
    anim(tr(rig.layer, "ADBE Rotate Y"), [[0, 16], [1.2, -3]], "snap");

    var ring = shape(comp, "Logo ring");
    var rg = ellipseGroup(ring, "ring", 420, [0, 0], null, C.amber, 6);
    drawOn(ring, rg, 0.15, 0.7);
    place3D(ring, [CX, 760, 40], 100);
    expr(tr(ring, "ADBE Rotate Z"), "time * -90;");

    var logo = logoMark(comp, "KVFX mark", 230);
    place3D(logo, [CX, 760, -60], 100);
    popIn(logo, 0.1, 100);
    anim(tr(logo, "ADBE Rotate Z"), [[0.1, -180], [0.6, 0]], "snap");

    var word = txt(comp, "KVFX TOOLS", { font: "display", size: 140, color: C.cream, maxW: 940, pos: [CX, 1060] });
    word.threeDLayer = true;
    charIn(word, 0.3, { stagger: 0.035, dur: 0.4, y: 0, scale: 0, blur: 20 });
    var trackA = textAnimator(word, "KV Tracking", [["ADBE Text Tracking Amount", 0]]);
    if (trackA) {
      try {
        trackA().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        anim(trackA().property("ADBE Text Animator Properties").property("ADBE Text Tracking Amount"), [[0.3, 260], [1.0, 0]], "snap");
      } catch (e) {
        warn("Tracking animator: " + errText(e));
      }
    }

    var tag = txt(comp, "after effects, but make it fast.", { font: "ui", size: 46, color: C.cream, pos: [CX, 1180] });
    tag.threeDLayer = true;
    tr(tag, "ADBE Opacity").setValue(80);
    charIn(tag, 0.85, { words: true, stagger: 0.07, dur: 0.3, y: 40, blur: 8 });

    var badges = txt(comp, "8 TABS  \u00B7  100+ COMMANDS  \u00B7  1 SHORTCUT", { font: "mono", size: 30, color: C.amber, tracking: 60, pos: [CX, 1290] });
    badges.threeDLayer = true;
    charIn(badges, 1.25, { stagger: 0.012, dur: 0.15, y: 0 });
  }

  // ---------------------------------------------------------------------------
  // Scene 03 - Inside the panel: real recordings of the panel, the graph its
  // curve editor drives, the ten text presets and the search palette.
  // ---------------------------------------------------------------------------

  function buildPanel(comp) {
    gradBg(comp, hex("#14161B"), C.ink);
    dotGrid(comp, C.cream, 5);
    radialGlow(comp, [CX, 700], 950, C.amber, 30, "Amber glow");
    chapter(comp, "KVFX", "INSIDE THE PANEL", 0, comp.duration, C.amber);

    // 1 - Ease. The recording drags the curve; the graph and the ball follow
    // it beat for beat, then Apply to Keys lands with its toast.
    var E1 = 5.4;
    var EASY = [0.333, 0, 0.667, 1];
    var DRAG = [0.165, 0.998, 0.667, 1];
    var EXPO = [0.165, 0.998, 0.301, 0.998];
    var BACK = [0.36, 0, 0.66, -0.56];
    graphEditor(comp, {
      x: CX, y: 640, t0: 0, t1: E1,
      keys: [[0, EASY, "EASY EASE"], [0.6, EASY, "CUSTOM"], [1.4, DRAG], [1.95, DRAG], [2.6, EXPO, "EXPO OUT"], [4.05, EXPO, "BACK"], [4.2, BACK]]
    });
    var easeCard = deviceCard(comp, { clip: "ease", from: 0, t0: 0, t1: E1, pos: [270, 1390], scale: 44, rotZ: -4 });
    anim(tr(easeCard, "ADBE Position"), [[0, [-320, 1390]], [0.35, [270, 1390]]], "snap");
    anim(tr(easeCard, "ADBE Position"), [[E1 - 0.25, [270, 1390]], [E1, [-400, 1390]]], "accel");
    easeCard.motionBlur = true;
    chip(comp, { tab: "Ease tab", title: "Curve editor", sub: "drag it. apply it. done.", t0: 0.3, t1: E1 - 0.05, x: 480, y: 1040 });
    pill(comp, "1 click, every selected key", { pos: [760, 1330], rot: 3, size: 32, font: "body", fill: C.amber, shadow: C.cream, t0: 5.05, t1: E1 });
    flash(comp, E1, C.white, 2, 60);

    // 2 - Text. A magnified look at the live preview, then all ten presets.
    var T0 = E1;
    var T1 = 9.2;
    zoomInset(comp, { clip: "text", from: 0.2, t0: T0, t1: T1, region: [16, 810, 728, 320], zoom: 1.32, pos: [CX, 560], rot: -1.5 });
    textReel(comp, T0 + 0.05, 0.37, 1130);
    chip(comp, { tab: "Text tab", title: "10 text presets", sub: "hover to preview, click to apply", t0: T0 + 0.2, t1: T1 - 0.05, x: 70, y: 1300 });
    flash(comp, T1, C.white, 2, 60);

    // 3 - Search. Ctrl + Space, three letters, Enter.
    var S0 = T1;
    var S1 = comp.duration;
    var cam = camRig(comp, "CAM Search", S0, S1);
    anim(tr(cam.layer, "ADBE Position"), [[S0, [CX, CY, -200]], [S1, [CX, CY, 60]]], "smooth");
    deviceCard(comp, { clip: "palette", from: 0, t0: S0, t1: S1, pos: [CX, 1330, 0], scale: 50, threeD: true, rotX: 12, rotY: -14, rotZ: 2, pop: true });
    zoomInset(comp, { clip: "palette", from: 0, t0: S0 + 0.1, t1: S1, region: [16, 52, 728, 170], zoom: 1.3, pos: [CX, 470], rot: 1.5 });
    var k1 = keycap(comp, "CTRL", CX - 170, 720, 210, S0 + 0.35);
    var plus = txt(comp, "+", { font: "display", size: 80, color: C.cream, pos: [CX - 10, 720] });
    var k2 = keycap(comp, "SPACE", CX + 170, 720, 320, S0 + 0.35);
    popIn(k1[0], S0 + 0.05, 100);
    popIn(k2[0], S0 + 0.12, 100);
    spanAll([k1[0], k1[1], k1[2], k2[0], k2[1], k2[2], plus], S0, S1);
    chip(comp, { tab: "Ctrl / Cmd + Space", title: "Search everything", sub: "100+ commands, 3 letters", t0: S0 + 1.0, t1: S1 - 0.05, x: 70, y: 1180 });
  }

  // ---------------------------------------------------------------------------
  // Scene 04 - Anime edits
  // ---------------------------------------------------------------------------

  function buildAnime(comp) {
    solid(comp, C.ink, "BG");
    titleCard(comp, "01", "ANIME EDITS", "AMV  \u00B7  EDITS  \u00B7  REELS", 0, 1.0, false);

    // Shot A - rooftop push-in, the hero drops in on the beat.
    var A0 = 1.0;
    var A1 = 3.5;
    var camA = camRig(comp, "CAM A", A0, A1);
    anim(tr(camA.layer, "ADBE Position"), [[A0, [CX, CY, -120]], [A1, [CX, CY, 380]]], "smooth");
    anim(tr(camA.layer, "ADBE Rotate Z"), [[A0, -3], [A1, 1]], "smooth");
    shakeBase(camA, 3);
    var cityA = still(comp, "anime/city.png", "City - rooftop");
    place3D(cityA, [CX, CY, 900], coverPct(cityA, depthK(900) * 1.15));
    glow(cityA, 40, 0.6);
    span(cityA, A0, A1);
    var heroA = still(comp, ["anime/hero-cutout.png", "anime/hero.png"], "Hero");
    place3D(heroA, [CX + 40, CY + 350, 0], heightPct(heroA, 2300));
    anim(tr(heroA, "ADBE Position"), [[2.0, [CX + 40, CY + 1400, 0]], [2.3, [CX + 40, CY + 350, 0]]], "snap");
    glow(heroA, 60, 0.8);
    heroA.motionBlur = true;
    span(heroA, 2.0, A1);
    rain(comp, A0, A1);
    flash(comp, 2.0, C.white, 2, 85);
    shakeHit(camA, 2.0, 45, 3);
    chip(comp, { tab: "Tools tab", title: "Split", sub: "cut on the beat in one click", t0: A0 + 0.25, t1: A1 - 0.06, x: 70, y: 1270 });

    // Shot B - eye close-up: zoom punch, chromatic glitch, camera shake.
    var B0 = 3.5;
    var B1 = 5.0;
    var camB = camRig(comp, "CAM B", B0, B1);
    anim(tr(camB.layer, "ADBE Position"), [[B0, [CX, CY, 0]], [B1, [CX, CY, 170]]], "smooth");
    shakeBase(camB, 7);
    shakeHit(camB, B0, 70, 7);
    var eye = still(comp, "anime/eye.png", "Eye");
    var es = coverPct(eye, 1.12);
    place3D(eye, [CX, CY, 0], es);
    anim(tr(eye, "ADBE Scale"), [[B0, [es * 1.4, es * 1.4, es * 1.4]], [B0 + 0.25, [es, es, es]]], "snap");
    span(eye, B0, B1);
    chroma(comp, eye, B0, B0 + 0.7, 26);
    flash(comp, B0, C.amber, 1, 70);
    chip(comp, { tab: "Ease tab", title: "Add Wiggle", sub: "instant camera shake", t0: B0 + 0.15, t1: B1 - 0.06, x: 70, y: 1270 });

    // Shot C - 2.5D parallax orbit around the hero.
    var C0 = 5.0;
    var C1 = 7.0;
    var camC = camRig(comp, "CAM C", C0, C1);
    anim(tr(camC.layer, "ADBE Rotate Y"), [[C0, -14], [C1, 10]], "smooth");
    anim(tr(camC.layer, "ADBE Position"), [[C0, [CX, CY, 0]], [C1, [CX, CY, 220]]], "smooth");
    shakeBase(camC, 2);
    var cityC = still(comp, "anime/city.png", "City - far");
    place3D(cityC, [CX, CY, 1400], coverPct(cityC, depthK(1400) * 1.35));
    blurLayer(cityC, 10);
    span(cityC, C0, C1);
    var heroC = still(comp, ["anime/hero-cutout.png", "anime/hero.png"], "Hero - parallax");
    place3D(heroC, [CX + 40, CY + 330, 0], heightPct(heroC, 2300));
    glow(heroC, 70, 0.9);
    span(heroC, C0, C1);
    var lines = speedLines(comp, "Speed lines", C.cream);
    place3D(lines, [CX, CY, -450], 100);
    tr(lines, "ADBE Opacity").setValue(16);
    span(lines, C0, C1);
    panelCard(comp, "ease", { clip: "ease", from: 0.5, t0: C0 + 0.1, t1: C1 - 0.06, x: W - 170, y: 990, scale: 40 });
    chip(comp, { tab: "Ease tab", title: "Curve editor", sub: "smooth speed ramps, any curve", t0: C0 + 0.15, t1: C1 - 0.06, x: 70, y: 1270 });

    // Shot D - impact: the leap slams in and overshoots (Add Elastic).
    var D0 = 7.0;
    var D1 = 9.0;
    var camD = camRig(comp, "CAM D", D0, D1);
    anim(tr(camD.layer, "ADBE Rotate Z"), [[D0, 4], [D1, -2]], "smooth");
    anim(tr(camD.layer, "ADBE Position"), [[D0, [CX, CY, 0]], [D1, [CX, CY, 140]]], "smooth");
    shakeBase(camD, 4);
    shakeHit(camD, D0 + 0.25, 60, 4);
    var cityD = still(comp, "anime/city.png", "City - impact");
    place3D(cityD, [CX, CY, 1000], coverPct(cityD, depthK(1000) * 1.2));
    blurLayer(cityD, 4);
    fx(cityD, "ADBE Tint", "Teal grade", [[1, rgba(C.ink)], [2, rgba(C.teal)], [3, 35]]);
    span(cityD, D0, D1);
    var leap = still(comp, ["anime/leap-cutout.png", "anime/leap.png"], "Leap");
    place3D(leap, [CX, CY + 60, 0], heightPct(leap, 2240));
    anim(tr(leap, "ADBE Position"), [[D0, [CX + 1300, CY + 200, 0]], [D0 + 0.25, [CX, CY + 60, 0]]], "linear");
    anim(tr(leap, "ADBE Rotate Z"), [[D0, -18], [D0 + 0.25, 0]], "linear");
    expr(tr(leap, "ADBE Position"), elasticExpression());
    expr(tr(leap, "ADBE Rotate Z"), elasticExpression());
    glow(leap, 50, 0.9);
    leap.motionBlur = true;
    span(leap, D0, D1);
    var ring = shape(comp, "Impact ring");
    ellipseGroup(ring, "ring", 200, [0, 0], null, C.amber, 10);
    setPos(ring, [CX, CY + 40]);
    anim(tr(ring, "ADBE Scale"), [[D0 + 0.25, [20, 20, 20]], [D0 + 0.6, [600, 600, 600]]], "snap");
    anim(tr(ring, "ADBE Opacity"), [[D0 + 0.25, 100], [D0 + 0.6, 0]], "smooth");
    span(ring, D0 + 0.25, D0 + 0.62);
    flash(comp, D0, C.white, 2, 85);
    flash(comp, D0 + 0.25, C.amber, 1, 80);
    chip(comp, { tab: "Ease tab", title: "Add Elastic", sub: "impact overshoot, no graph editor", t0: D0 + 0.15, t1: D1 - 0.06, x: 70, y: 1270 });

    // Shot E - lyric that builds letter by letter, then explodes.
    var E0 = 9.0;
    var E1 = 11.0;
    var camE = camRig(comp, "CAM E", E0, E1);
    anim(tr(camE.layer, "ADBE Position"), [[E0, [CX, CY, 0]], [E1, [CX, CY, 150]]], "smooth");
    anim(tr(camE.layer, "ADBE Rotate Z"), [[E0, -1.5], [E1, 1.5]], "smooth");
    shakeBase(camE, 2);
    shakeHit(camE, E0 + 1.35, 40, 2);
    var cityE = still(comp, "anime/city.png", "City - lyric bg");
    place3D(cityE, [CX, CY, 600], coverPct(cityE, depthK(600) * 1.15));
    blurLayer(cityE, 36);
    span(cityE, E0, E1);
    var dim = solid(comp, C.ink, "Dim");
    tr(dim, "ADBE Opacity").setValue(55);
    span(dim, E0, E1);
    var lyric = txt(comp, "I'M NOT\rDONE YET", { font: "display", size: 170, color: C.cream, leading: 180, maxW: 940, pos: [CX, CY - 60] });
    lyric.threeDLayer = true;
    charIn(lyric, E0 + 0.1, { stagger: 0.04, dur: 0.35, y: 0, scale: 0, rot: -40, blur: 20 });
    charScatter(lyric, E0 + 1.35, 0.55);
    glow(lyric, 30, 0.6);
    span(lyric, E0, E1);
    flash(comp, E0 + 1.35, C.white, 1, 60);
    chip(comp, { tab: "Text tab", title: "Explode", sub: "every letter on its own layer", t0: E0 + 0.2, t1: E1 - 0.06, x: 70, y: 1270 });

    // Shot F - the stills on a spinning 3D ring.
    var F0 = 11.0;
    var F1 = 13.0;
    var camF = camRig(comp, "CAM F", F0, F1);
    tr(camF.layer, "ADBE Rotate X").setValue(-12);
    anim(tr(camF.layer, "ADBE Position"), [[F0, [CX, CY, -160]], [F1, [CX, CY, 120]]], "smooth");
    var halo = radialGlow(comp, [CX, CY - 60], 760, C.amber, 40, "Ring glow");
    if (halo) span(halo, F0, F1);
    carousel(comp, F0, F1);
    chip(comp, { tab: "Generate tab", title: "3D Carousel", sub: "spin any layers on a ring", t0: F0 + 0.15, t1: F0 + 1.0, x: 70, y: 1300 });
    chip(comp, { tab: "Tools tab", title: "Sequence", sub: "stagger 40 clips in one click", t0: F0 + 1.0, t1: F1 - 0.05, x: 70, y: 1300 });

    chapter(comp, "01", "ANIME EDITS", 1.0, comp.duration, C.amber);
  }

  // Curve editor mock: a cubic-bezier(.16, 1, .3, 1) drawing itself.
  // The same rig the panel's 3D Carousel builds: a hub null with Radius and
  // Spin sliders, cards placed by expression and turned to face outwards.
  function carousel(comp, t0, t1) {
    var hub = nul(comp, "KVFX Carousel", [CX, CY - 60, 0], true);
    var radiusIdx = slider(hub, "Radius", 470);
    var spinIdx = slider(hub, "Spin", 0);
    anim(fxProp(hub, spinIdx, 1), [[t0, -40], [t1, 150]], "smooth");
    if (!radiusIdx) warn("Carousel radius slider missing");
    span(hub, t0, t1);
    var files = [["anime/city.png"], ["anime/hero.png", "anime/hero-cutout.png"], ["anime/leap.png", "anime/leap-cutout.png"], ["anime/eye.png"]];
    var count = files.length;
    for (var i = 0; i < count; i++) {
      var card = still(comp, files[i], "Card " + (i + 1));
      card.threeDLayer = true;
      card.parent = hub;
      var cardPct = heightPct(card, 680);
      setScale(card, cardPct);
      expr(tr(card, "ADBE Position"), [
        "// KVFX Tools - carousel",
        "var count = " + count + ";",
        "var slot = " + i + ";",
        "var radius = parent.effect(\"Radius\")(1);",
        "var spin = parent.effect(\"Spin\")(1);",
        "var a = degreesToRadians(spin + slot * 360 / count);",
        "var c = parent.anchorPoint;",
        "[c[0] + radius * Math.sin(a), c[1], c[2] - radius * Math.cos(a)];"
      ].join("\n"));
      expr(tr(card, "ADBE Orientation"), "// KVFX Tools - carousel\nlookAt(position, parent.anchorPoint);");
      popIn(card, t0 + i * 0.1, cardPct);
      span(card, t0, t1);
    }
  }

  // ---------------------------------------------------------------------------
  // Scene 05 - SaaS promo
  // ---------------------------------------------------------------------------

  var DASH_W = 1000;
  var DASH_H = 1400;

  function buildDashboard(dc) {
    // Window: white card, thick outline, hard shadow (neo-brutalist UI).
    var win = shape(dc, "Window");
    rectGroup(win, "card", 960, 1360, 44, [0, 0], C.white, C.ink, 6);
    rectGroup(win, "hard shadow", 960, 1360, 44, [16, 16], C.ink, null, 0);
    setPos(win, [DASH_W / 2 - 8, DASH_H / 2 - 8]);

    var bar = shape(dc, "Top bar");
    ellipseGroup(bar, "close", 22, [80, 76], C.pink, C.ink, 3);
    ellipseGroup(bar, "min", 22, [116, 76], C.amber, C.ink, 3);
    ellipseGroup(bar, "max", 22, [152, 76], C.teal, C.ink, 3);
    pathGroup(bar, "divider", [[28, 126], [962, 126]], false, null, C.ink, 4);
    txt(dc, "nova.app / dashboard", { font: "mono", size: 22, color: C.mute, pos: [DASH_W / 2, 76] });

    txt(dc, "Good morning, Sam", { font: "ui", size: 46, color: C.ink, just: LEFT, anchor: "left", pos: [70, 200] });
    txt(dc, "here's your week", { font: "body", size: 28, color: C.mute, just: LEFT, anchor: "left", pos: [70, 250] });

    // Upgrade button + click ripple.
    var btnT = txt(dc, "Upgrade", { font: "ui", size: 28, color: C.ink, pos: [0, 0] });
    var btnB = shape(dc, "Upgrade button");
    rectGroup(btnB, "pill", 200, 66, 33, [0, 0], C.amber, C.ink, 4);
    btnB.moveAfter(btnT);
    var btn = nul(dc, "Upgrade", [820, 210]);
    parentAll([btnB, btnT], btn);
    setPos(btnB, [0, 0]);
    setPos(btnT, [0, 0]);
    anim(tr(btn, "ADBE Scale"), [[5.6, [100, 100, 100]], [5.68, [90, 90, 90]], [5.85, [100, 100, 100]]], "snap");
    var ripple = shape(dc, "Click ripple");
    ellipseGroup(ripple, "ripple", 60, [0, 0], null, C.amber, 6);
    setPos(ripple, [820, 210]);
    anim(tr(ripple, "ADBE Scale"), [[5.62, [30, 30, 30]], [6.0, [420, 420, 420]]], "snap");
    anim(tr(ripple, "ADBE Opacity"), [[5.62, 100], [6.0, 0]], "smooth");
    span(ripple, 5.62, 6.02);

    // KPI cards: they land slightly messy, then snap into an aligned,
    // evenly distributed row (the Align + Distribute beat).
    var cards = [
      { label: "MRR", to: 48920, prefix: "$", suffix: "", delta: "+12.4%", messy: [-40, 34, -6] },
      { label: "ACTIVE USERS", to: 12480, prefix: "", suffix: "", delta: "+8.1%", messy: [26, -24, 5] },
      { label: "GROWTH", to: 312, prefix: "+", suffix: "%", delta: "this month", messy: [-14, 42, -3] }
    ];
    var xs = [215, 500, 785];
    for (var i = 0; i < cards.length; i++) {
      var cd = cards[i];
      var box = shape(dc, "KPI box " + (i + 1));
      rectGroup(box, "card", 270, 210, 26, [0, 0], C.paper, C.ink, 4);
      var lab = txt(dc, cd.label, { font: "mono", size: 20, color: C.mute, just: LEFT, anchor: "left", tracking: 40 });
      var valText = cd.prefix + String(cd.to).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + cd.suffix;
      var val = txt(dc, valText, { font: "display", size: 50, color: C.ink, just: LEFT, anchor: "left", maxW: 230 });
      var del = txt(dc, cd.delta, { font: "mono", size: 20, color: hex("#0E9F92"), just: LEFT, anchor: "left" });
      var counterIdx = fx(val, "ADBE Slider Control", "KVFX Counter", [[1, 0]]);
      anim(fxProp(val, counterIdx, 1), [[1.4 + i * 0.1, 0], [2.9 + i * 0.1, 100]], "snap");
      expr(textDoc(val), counterExpression(cd.to, cd.prefix, cd.suffix));
      var holder = nul(dc, "KPI " + (i + 1), [xs[i] + cd.messy[0], 430 + cd.messy[1]]);
      parentAll([box, lab, val, del], holder);
      setPos(box, [0, 0]);
      setPos(lab, [-112, -62]);
      setPos(val, [-112, 0]);
      setPos(del, [-112, 64]);
      tr(holder, "ADBE Rotate Z").setValue(cd.messy[2]);
      popIn(holder, 1.25 + i * 0.1, 100);
      anim(tr(holder, "ADBE Position"), [[4.6, [xs[i] + cd.messy[0], 430 + cd.messy[1]]], [4.9, [xs[i], 430]]], "snap");
      anim(tr(holder, "ADBE Rotate Z"), [[4.6, cd.messy[2]], [4.9, 0]], "snap");
    }

    // Revenue chart: bars grow from their bottom edge (anchor at the base).
    var chartBox = shape(dc, "Chart box");
    rectGroup(chartBox, "card", 880, 480, 26, [0, 0], C.paper, C.ink, 4);
    pathGroup(chartBox, "grid 1", [[-400, -60], [400, -60]], false, null, hex("#D9D2C5"), 2);
    pathGroup(chartBox, "grid 2", [[-400, 40], [400, 40]], false, null, hex("#D9D2C5"), 2);
    pathGroup(chartBox, "grid 3", [[-400, 140], [400, 140]], false, null, hex("#D9D2C5"), 2);
    setPos(chartBox, [DASH_W / 2, 810]);
    txt(dc, "Revenue", { font: "ui", size: 30, color: C.ink, just: LEFT, anchor: "left", pos: [90, 612] });
    var heights = [150, 210, 180, 260, 240, 300, 370];
    var tops = [];
    for (var b = 0; b < heights.length; b++) {
      var bx = 152 + b * 116;
      var barL = shape(dc, "Bar " + (b + 1));
      rectGroup(barL, "bar", 70, heights[b], 14, [0, -heights[b] / 2], b === heights.length - 1 ? C.amber : C.ink, C.ink, 3);
      setPos(barL, [bx, 1020]);
      anim(tr(barL, "ADBE Scale"), [[6.2 + b * 0.06, [100, 0, 100]], [6.55 + b * 0.06, [100, 100, 100]]], "snap");
      tops.push([bx, 1020 - heights[b] - 26]);
    }
    var line = shape(dc, "Trend line");
    var lg = pathGroup(line, "trend", tops, false, null, hex("#0E9F92"), 7);
    drawOn(line, lg, 6.7, 7.4);

    // Signup rows: staggered top to bottom (the Sequence beat).
    txt(dc, "Recent signups", { font: "ui", size: 30, color: C.ink, just: LEFT, anchor: "left", pos: [90, 1112] });
    var rows = [["@luna.designs", "PRO", C.pink], ["@kai.motion", "TEAM", C.teal], ["@mira.edits", "PRO", C.amber]];
    for (var r = 0; r < rows.length; r++) {
      var y = 1180 + r * 62;
      var dot = shape(dc, "Avatar " + (r + 1));
      ellipseGroup(dot, "avatar", 40, [0, 0], rows[r][2], C.ink, 3);
      setPos(dot, [110, y]);
      var name = txt(dc, rows[r][0], { font: "body", size: 26, color: C.ink, just: LEFT, anchor: "left", pos: [146, y] });
      var plan = txt(dc, rows[r][1], { font: "mono", size: 20, color: C.amberDeep, tracking: 60, pos: [860, y] });
      var rowParts = [dot, name, plan];
      for (var q = 0; q < rowParts.length; q++) {
        var p0 = tr(rowParts[q], "ADBE Position").value;
        anim(tr(rowParts[q], "ADBE Position"), [[3.0 + r * 0.09, [p0[0] + 80, p0[1]]], [3.35 + r * 0.09, [p0[0], p0[1]]]], "snap");
        anim(tr(rowParts[q], "ADBE Opacity"), [[3.0 + r * 0.09, 0], [3.15 + r * 0.09, 100]], "linear");
      }
    }

    // Cursor tour: card, rows, cards again, the button, the chart.
    var cursor = shape(dc, "Cursor");
    pathGroup(cursor, "arrow", [[0, 0], [0, 46], [12, 35], [21, 54], [30, 50], [21, 31], [37, 31]], true, C.ink, C.white, 3);
    anim(tr(cursor, "ADBE Position"), [
      [1.6, [1100, 1500]], [2.1, [300, 470]], [3.0, [420, 1190]], [4.5, [520, 470]], [5.5, [828, 216]], [6.2, [600, 900]]
    ], "snap");
    anim(tr(cursor, "ADBE Scale"), [[5.6, [100, 100, 100]], [5.66, [82, 82, 82]], [5.8, [100, 100, 100]]], "snap");
    cursor.motionBlur = true;
  }

  function buildSaas(comp, dashComp) {
    solid(comp, C.paper, "BG");
    dotGrid(comp, C.ink, 9);
    titleCard(comp, "02", "SAAS PROMOS", "UI  \u00B7  DASHBOARDS  \u00B7  LAUNCHES", 0, 1.0, true);

    var cam = camRig(comp, "CAM SaaS", 1.0, comp.duration);
    anim(tr(cam.layer, "ADBE Position"), [[1.0, [CX, CY, -320]], [2.4, [CX, CY, 0]]], "snap");
    anim(tr(cam.layer, "ADBE Position"), [[2.4, [CX, CY, 0]], [9.0, [CX, CY, 140]]], "smooth");

    var dash = comp.layers.add(dashComp);
    dash.name = "Dashboard";
    place3D(dash, [CX, CY + 80, 0], 100);
    try {
      dash.collapseTransformation = true;
    } catch (e) {
      // Without collapse the dashboard is still sharp at 100%.
    }
    anim(tr(dash, "ADBE Rotate X"), [[1.0, 38], [2.4, 8]], "snap");
    anim(tr(dash, "ADBE Rotate Y"), [[1.0, -28], [2.4, -8]], "snap");
    anim(tr(dash, "ADBE Rotate Y"), [[2.4, -8], [9.0, 5]], "smooth");
    span(dash, 1.0, comp.duration);

    // Gradient Lock: the headline types on and the gradient re-fits every frame.
    var head = txt(comp, "SHIP FASTER.", { font: "display", size: 150, color: C.amber, maxW: 940, pos: [CX, 470] });
    expr(textDoc(head), [
      "var s = \"SHIP FASTER.\";",
      "var n = Math.floor(clamp((time - 7.6) / 0.07, 0, s.length));",
      "s.substr(0, n);"
    ].join("\n"));
    gradientLock(head, C.amber, C.pink);
    dropShadow(head, 12, 0);
    span(head, 7.5, 9.0);

    // Duplicate Comp + Nested: the dashboard becomes three versions.
    var V0 = 9.0;
    anim(tr(dash, "ADBE Scale"), [[V0, [100, 100, 100]], [V0 + 0.35, [46, 46, 46]]], "snap");
    var versions = [
      { fx: "ADBE Invert", name: "Version - dark", x: CX + 330, rotY: -22, label: "COPY \u00B7 DARK" },
      { fx: "ADBE Color Balance (HLS)", name: "Version - client B", x: CX - 330, rotY: 22, label: "COPY \u00B7 CLIENT B" }
    ];
    for (var v = 0; v < versions.length; v++) {
      var vc = comp.layers.add(dashComp);
      vc.name = versions[v].name;
      place3D(vc, [CX, CY + 80, 0], 46);
      try {
        vc.collapseTransformation = true;
      } catch (e2) {
        // See above.
      }
      if (versions[v].fx === "ADBE Invert") fx(vc, "ADBE Invert", "Dark mode");
      else fx(vc, versions[v].fx, "Rebrand", [[1, 150]]);
      tr(vc, "ADBE Rotate X").setValue(8);
      anim(tr(vc, "ADBE Position"), [[V0 + 0.15, [CX, CY + 80, 0]], [V0 + 0.55, [versions[v].x, CY + 80, 220]]], "snap");
      anim(tr(vc, "ADBE Rotate Y"), [[V0 + 0.15, 0], [V0 + 0.55, versions[v].rotY]], "snap");
      vc.moveAfter(dash);
      span(vc, V0 + 0.15, comp.duration);
      pill(comp, versions[v].label, { pos: [versions[v].x, 560], size: 26, font: "mono", tracking: 60, fill: C.ink, ink: C.cream, rot: v === 0 ? 4 : -4, t0: V0 + 0.6 + v * 0.1, t1: comp.duration });
    }
    pill(comp, "ORIGINAL", { pos: [CX, 520], size: 26, font: "mono", tracking: 60, fill: C.amber, rot: -2, t0: V0 + 0.5, t1: comp.duration });

    var cy0 = 320;
    chip(comp, { tab: "Generate tab", title: "Number Counter", sub: "eased counters, any format", t0: 1.3, t1: 2.9, x: 70, y: cy0, theme: "ink" });
    chip(comp, { tab: "Tools tab", title: "Sequence", sub: "rows stagger in, top to bottom", t0: 2.9, t1: 4.5, x: 70, y: cy0, theme: "ink" });
    chip(comp, { tab: "Align bar", title: "Align + Distribute", sub: "pixel-perfect rows, zero nudging", t0: 4.5, t1: 6.1, x: 70, y: cy0, theme: "ink" });
    chip(comp, { tab: "Anchor grid", title: "Anchor Grid", sub: "grow from any edge or corner", t0: 6.1, t1: 7.5, x: 70, y: cy0, theme: "ink" });
    chip(comp, { tab: "Tools tab", title: "Gradient Lock", sub: "gradients that stay fitted", t0: 7.5, t1: 9.0, x: 70, y: 1330, theme: "ink" });
    chip(comp, { tab: "Tools tab", title: "Duplicate Comp + Nested", sub: "new versions, nothing breaks", t0: 9.0, t1: comp.duration - 0.05, x: 70, y: 1330, theme: "ink" });
    panelCard(comp, "generate", { clip: "generate", from: 0.4, t0: 1.3, t1: 2.9, x: W - 150, y: 1180, scale: 40 });
    panelCard(comp, "tools", { clip: "tools", from: 0.1, t0: 2.9, t1: 4.5, x: W - 150, y: 1180, scale: 40 });
    chapter(comp, "02", "SAAS PROMOS", 1.0, comp.duration, C.amberDeep);
  }

  // ---------------------------------------------------------------------------
  // Scene 06 - Everyday mograph (four tiles, then media + library)
  // ---------------------------------------------------------------------------

  var TILE_W = 460;
  var TILE_H = 560;

  function buildTileType(tc) {
    solid(tc, C.ink2, "BG");
    var a = txt(tc, "MAKE", { font: "display", size: 110, color: C.cream, maxW: 400, pos: [TILE_W / 2, 150] });
    var b = txt(tc, "IT", { font: "display", size: 130, color: C.amber, maxW: 400, pos: [TILE_W / 2, 280] });
    var c = txt(tc, "POP.", { font: "display", size: 150, color: C.cream, fill: false, stroke: C.cream, strokeWidth: 4, maxW: 400, pos: [TILE_W / 2, 420] });
    charIn(a, 1.3, { stagger: 0.05, dur: 0.35, y: 0, scale: 0 });
    charIn(b, 1.65, { stagger: 0.06, dur: 0.4, y: 80, blur: 12 });
    charIn(c, 2.0, { stagger: 0.08, dur: 0.05, y: 0 });
  }

  function buildTileLowerThird(tc) {
    var bgl = still(tc, "anime/city.png", "Footage");
    setScale(bgl, coverPct(bgl, 1.1, TILE_W, TILE_H));
    setPos(bgl, [TILE_W / 2, TILE_H / 2]);
    blurLayer(bgl, 18);
    var dim = solid(tc, C.ink, "Dim");
    tr(dim, "ADBE Opacity").setValue(45);
    var bar = shape(tc, "Name bar");
    rectGroup(bar, "bar", 380, 84, 10, [190, 0], C.amber, null, 0);
    setPos(bar, [36, 400]);
    anim(tr(bar, "ADBE Scale"), [[1.5, [0, 100, 100]], [1.85, [100, 100, 100]]], "snap");
    glow(bar, 40, 0.7);
    var sub = shape(tc, "Role bar");
    rectGroup(sub, "bar", 280, 46, 8, [140, 0], C.ink, null, 0);
    setPos(sub, [36, 466]);
    anim(tr(sub, "ADBE Scale"), [[1.7, [0, 100, 100]], [2.0, [100, 100, 100]]], "snap");
    var nm = txt(tc, "ALEX RIVERA", { font: "ui", size: 42, color: C.ink, just: LEFT, anchor: "left", tracking: 20, pos: [58, 400] });
    charIn(nm, 1.75, { stagger: 0.025, dur: 0.25, y: 0, blur: 10 });
    var role = txt(tc, "motion designer", { font: "body", size: 24, color: C.cream, just: LEFT, anchor: "left", pos: [52, 466] });
    charIn(role, 1.95, { stagger: 0.02, dur: 0.2, y: 0 });
    dropShadow(nm, 6, 10);
  }

  function buildTileExtrude(tc) {
    solid(tc, C.ink2, "BG");
    radialGlow(tc, [TILE_W / 2, TILE_H / 2], 300, C.amber, 40, "Glow");
    var rig = camRig(tc, "CAM Tile");
    tr(rig.layer, "ADBE Rotate X").setValue(-14);
    var spin = nul(tc, "Extrude spin", [TILE_W / 2, TILE_H / 2, 0], true);
    anim(tr(spin, "ADBE Rotate Y"), [[1.2, -50], [5.5, 320]], "smooth");
    tr(spin, "ADBE Rotate X").setValue(12);
    // Stacked, darker slices behind the face: what 3D Extrude builds.
    var slices = 14;
    for (var i = slices; i >= 1; i--) {
      var s = logoMark(tc, "Slice " + i, 170, C.amberDark, C.amberDark);
      s.threeDLayer = true;
      s.parent = spin;
      setPos(s, [0, 0, i * 4]);
    }
    var face = logoMark(tc, "Face", 170, C.amber, C.ink);
    face.threeDLayer = true;
    face.parent = spin;
    setPos(face, [0, 0, 0]);
    popIn(spin, 1.2, 100);
  }

  function buildTileLabels(tc) {
    solid(tc, C.ink2, "BG");
    var labels = ["#B53838", "#E4D84C", "#A9CBC7", "#E5BCC9", "#A9A9CA", "#E7C19E", "#B3C7B3", "#677DE0",
      "#4AA44C", "#8E2C9A", "#E8920D", "#7F452A", "#F46DD6", "#3DA2A5", "#A89677", "#1E401E"];
    for (var i = 0; i < labels.length; i++) {
      var col = i % 4;
      var row = Math.floor(i / 4);
      var sw = shape(tc, "Label " + (i + 1));
      rectGroup(sw, "swatch", 84, 84, 18, [0, 0], hex(labels[i]), C.ink, 4);
      setPos(sw, [TILE_W / 2 - 150 + col * 100, TILE_H / 2 - 150 + row * 100]);
      popIn(sw, 1.4 + i * 0.035, 100);
      anim(tr(sw, "ADBE Scale"), [[3.2 + row * 0.08, [100, 100, 100]], [3.32 + row * 0.08, [118, 118, 118]], [3.5 + row * 0.08, [100, 100, 100]]], "snap");
    }
  }

  function buildMograph(comp, tiles) {
    solid(comp, C.ink, "BG");
    dotGrid(comp, C.cream, 5);
    titleCard(comp, "03", "EVERYDAY MOGRAPH", "TYPE  \u00B7  LOWER THIRDS  \u00B7  LOGOS", 0, 1.0, false);

    var spots = [[CX - 250, 680], [CX + 250, 680], [CX - 250, 1270], [CX + 250, 1270]];
    var chips = [
      { tab: "Text tab", title: "Animate", sub: "pop \u00B7 rise \u00B7 typewriter + 7 more" },
      { tab: "FX tab", title: "One-click FX", sub: "glow, shadow, tint, blur" },
      { tab: "Generate tab", title: "3D Extrude", sub: "real depth in seconds" },
      { tab: "Labels tab", title: "Labels", sub: "color-code the chaos" }
    ];
    for (var i = 0; i < tiles.length; i++) {
      var t = comp.layers.add(tiles[i]);
      t.name = "Tile " + (i + 1);
      setPos(t, spots[i]);
      roundedMask(t, TILE_W, TILE_H, 36);
      var frame = shape(comp, "Tile frame " + (i + 1));
      rectGroup(frame, "frame", TILE_W, TILE_H, 36, [0, 0], null, C.cream, 4);
      rectGroup(frame, "hard shadow", TILE_W, TILE_H, 36, [10, 10], C.amber, null, 0);
      frame.moveAfter(t);
      var frameTop = shape(comp, "Tile outline " + (i + 1));
      rectGroup(frameTop, "outline", TILE_W, TILE_H, 36, [0, 0], null, C.cream, 4);
      var g = nul(comp, "Tile group " + (i + 1), spots[i]);
      parentAll([t, frame, frameTop], g);
      setPos(t, [0, 0]);
      setPos(frame, [0, 0]);
      setPos(frameTop, [0, 0]);
      popIn(g, 1.0 + i * 0.1, 100);
      popOut(g, 5.5 + i * 0.05, 100);
      spanAll([t, frame, frameTop, g], 1.0, 5.7);
      chip(comp, {
        tab: chips[i].tab, title: chips[i].title, sub: chips[i].sub,
        t0: 1.5 + i * 0.2, t1: 5.35, x: spots[i][0] - 215, y: spots[i][1] + 150, scale: 62, rot: i % 2 === 0 ? -4 : 3
      });
    }

    // Media + Library: the panel's own tabs, tilted in 3D.
    var M0 = 5.5;
    var M1 = comp.duration;
    var rig = camRig(comp, "CAM Panels", M0, M1);
    anim(tr(rig.layer, "ADBE Rotate Y"), [[M0, 16], [M1, -8]], "smooth");
    anim(tr(rig.layer, "ADBE Position"), [[M0, [CX, CY, -220]], [M1, [CX, CY, 60]]], "smooth");
    var media = still(comp, "ui/media.png", "Panel \u00B7 media");
    place3D(media, [CX - 200, CY - 30, 0], 50);
    tr(media, "ADBE Rotate Y").setValue(14);
    popIn(media, M0, 50);
    span(media, M0, M1);
    var lib = still(comp, "ui/library.png", "Panel \u00B7 library");
    place3D(lib, [CX + 230, CY + 50, 180], 50);
    tr(lib, "ADBE Rotate Y").setValue(-14);
    popIn(lib, M0 + 0.15, 50);
    span(lib, M0, M1);

    // A screenshot "file" flying into the Media tab.
    var file = shape(comp, "Dropped file");
    rectGroup(file, "file", 180, 130, 18, [0, 0], C.cream, C.ink, 5);
    rectGroup(file, "thumb", 140, 70, 10, [0, -12], C.teal, C.ink, 3);
    var fileLabel = txt(comp, "PNG", { font: "mono", size: 22, color: C.ink, pos: [0, 0] });
    fileLabel.parent = file;
    setPos(fileLabel, [0, 44]);
    anim(tr(file, "ADBE Position"), [[M0 + 0.4, [-200, 300]], [M0 + 0.85, [CX - 200, CY - 120]]], "snap");
    anim(tr(file, "ADBE Scale"), [[M0 + 0.95, [100, 100, 100]], [M0 + 1.1, [0, 0, 0]]], "accel");
    anim(tr(file, "ADBE Rotate Z"), [[M0 + 0.4, -30], [M0 + 0.85, 6]], "snap");
    file.motionBlur = true;
    spanAll([file, fileLabel], M0 + 0.4, M0 + 1.12);

    chip(comp, { tab: "Media tab", title: "Paste + Drop", sub: "Ctrl+V straight into your comp", t0: M0 + 0.1, t1: M0 + 1.3, x: 70, y: 1300 });
    chip(comp, { tab: "Library tab", title: "Library", sub: "your assets, one click away", t0: M0 + 1.3, t1: M1 - 0.05, x: 70, y: 1300 });
    chapter(comp, "03", "EVERYDAY MOGRAPH", 1.0, comp.duration, C.amber);
  }

  // ---------------------------------------------------------------------------
  // Scene 07 - Feature wall
  // ---------------------------------------------------------------------------

  function ticker(comp, str, y, rot, bandCol, textCol, speed) {
    var band = shape(comp, "Ticker band");
    rectGroup(band, "band", 1700, 92, 0, [0, 0], bandCol, C.ink, 5);
    setPos(band, [CX, y]);
    tr(band, "ADBE Rotate Z").setValue(rot);
    var t = txt(comp, str + str + str, { font: "mono", size: 38, color: textCol, just: LEFT, anchor: "left", tracking: 40, maxW: 100000 });
    t.parent = band;
    // A ticker moving right starts further left so its left end never shows.
    setPos(t, [speed < 0 ? -850 + speed * comp.duration * 1.2 : -850, 0]);
    expr(tr(t, "ADBE Position"), "[value[0] - time * " + speed + ", value[1]];");
    return band;
  }

  function buildFeatures(comp) {
    solid(comp, C.ink, "BG");
    ticker(comp, TICKER_A, 330, -6, C.amber, C.ink, 260);
    ticker(comp, TICKER_B, 1560, 5, C.cream, C.ink, -260);

    // Everything in the first half hangs off one null so it can whip out
    // together. Positions below are relative to that null (screen centre).
    var holder = nul(comp, "Headline group", [CX, CY]);
    var h1 = txt(comp, "8 TABS.", { font: "display", size: 130, color: C.cream });
    var h2 = txt(comp, "100+ COMMANDS.", { font: "display", size: 120, color: C.cream, maxW: 940 });
    var h3 = txt(comp, "1 SHORTCUT.", { font: "display", size: 130, color: C.amber, maxW: 940 });
    var plus = txt(comp, "+", { font: "display", size: 80, color: C.cream });
    var hint = txt(comp, "CMD + SPACE on Mac \u00B7 search every command", { font: "body", size: 28, color: C.mute });
    var heads = [[h1, 690], [h2, 850], [h3, 1010], [hint, 1320]];
    for (var hI = 0; hI < heads.length; hI++) {
      heads[hI][0].parent = holder;
      setPos(heads[hI][0], [0, heads[hI][1] - CY]);
    }
    plus.parent = holder;
    setPos(plus, [-40, 1190 - CY]);
    slam(h1, 0.15, 170);
    slam(h2, 0.5, 170);
    slam(h3, 0.85, 190);
    var k1 = keycap(comp, "CTRL", -200, 1190 - CY, 210, 1.5, holder);
    var k2 = keycap(comp, "SPACE", 150, 1190 - CY, 320, 1.5, holder);
    charIn(hint, 1.6, { stagger: 0.01, dur: 0.15, y: 0 });
    var first = [h1, h2, h3, plus, hint, k1[0], k1[1], k1[2], k2[0], k2[1], k2[2]];
    for (var i = 0; i < first.length; i++) first[i].motionBlur = true;
    popIn(k1[0], 1.2, 100);
    popIn(k2[0], 1.3, 100);
    anim(tr(holder, "ADBE Position"), [[2.1, [CX, CY]], [2.35, [CX, CY - 2400]]], "accel");
    first.push(holder);
    spanAll(first, 0, 2.4);

    // Every tab of the panel, fanned out in 3D.
    var T0 = 2.3;
    var rig = camRig(comp, "CAM Wall", T0, comp.duration);
    anim(tr(rig.layer, "ADBE Position"), [[T0, [CX, CY, -300]], [comp.duration, [CX, CY, 40]]], "smooth");
    anim(tr(rig.layer, "ADBE Rotate Y"), [[T0, -10], [comp.duration, 8]], "smooth");
    var tabs = ["tools", "ease", "text", "fx", "generate", "labels", "library", "media"];
    for (var t = 0; t < tabs.length; t++) {
      var off = t - (tabs.length - 1) / 2;
      var shot = still(comp, "ui/" + tabs[t] + ".png", "Tab \u00B7 " + tabs[t]);
      place3D(shot, [CX + off * 250, CY + 40, Math.abs(off) * Math.abs(off) * 60 + 200], 34);
      tr(shot, "ADBE Rotate Y").setValue(-off * 9);
      popIn(shot, T0 + 0.05 * t, 34);
      span(shot, T0, comp.duration);
    }
    var pal = panelClip(comp, "palette", "tools-palette", 3.0, comp.duration, 0.6);
    place3D(pal, [CX, CY + 20, -260], 40);
    dropShadow(pal, 40, 120);
    popIn(pal, 3.0, 40);
    span(pal, 3.0, comp.duration);
    var names = txt(comp, "TOOLS \u00B7 EASE \u00B7 TEXT \u00B7 FX \u00B7 GENERATE \u00B7 LABELS \u00B7 LIBRARY \u00B7 MEDIA", { font: "mono", size: 26, color: C.amber, tracking: 40, maxW: 960, pos: [CX, 1480] });
    charIn(names, T0 + 0.2, { stagger: 0.01, dur: 0.12, y: 0 });
    span(names, T0, comp.duration);
    chip(comp, { tab: "Every command", title: "One undo", sub: "Ctrl+Z always has your back", t0: 3.3, t1: comp.duration - 0.05, x: 70, y: 300, theme: "amber" });
  }

  // ---------------------------------------------------------------------------
  // Scene 08 - Call to action
  // ---------------------------------------------------------------------------

  function buildCta(comp) {
    solid(comp, C.amber, "BG");
    dotGrid(comp, C.ink, 10);
    var rig = camRig(comp, "CAM CTA");
    anim(tr(rig.layer, "ADBE Position"), [[0, [CX, CY, -320]], [0.6, [CX, CY, 0]]], "snap");
    anim(tr(rig.layer, "ADBE Position"), [[0.6, [CX, CY, 0]], [comp.duration, [CX, CY, 90]]], "smooth");

    var logo = logoMark(comp, "KVFX mark", 210, C.ink, C.amber);
    place3D(logo, [CX, 640, 0], 100);
    popIn(logo, 0.1, 100);
    anim(tr(logo, "ADBE Rotate Z"), [[0.1, 180], [0.6, 0]], "snap");
    pill(comp, "NEW", { pos: [CX + 170, 520], rot: 12, size: 30, font: "mono", tracking: 80, fill: C.cream, t0: 0.4, threeD: true });

    var word = txt(comp, "KVFX TOOLS", { font: "display", size: 150, color: C.ink, maxW: 940, pos: [CX, 900] });
    word.threeDLayer = true;
    charIn(word, 0.25, { stagger: 0.035, dur: 0.35, y: 100, blur: 12 });
    var tag = txt(comp, "after effects, but make it fast.", { font: "ui", size: 44, color: C.ink, pos: [CX, 1010] });
    tag.threeDLayer = true;
    charIn(tag, 0.55, { words: true, stagger: 0.06, dur: 0.3, y: 30 });

    var cta = pill(comp, "LINK IN BIO", { pos: [CX, 1200], size: 64, font: "display", fill: C.ink, ink: C.cream, padX: 56, padY: 30, shadow: C.cream, t0: 0.9, threeD: true });
    expr(tr(cta, "ADBE Scale"), "var s = time > " + (0.9 + 12 * FD) + " ? 100 + 4 * Math.sin((time - 0.9) * 8) : value[0];\n[s, s, s];");
    var save = txt(comp, "save this for your next edit", { font: "body", size: 36, color: C.ink, pos: [CX, 1350] });
    charIn(save, 1.3, { words: true, stagger: 0.06, dur: 0.25, y: 30 });
    var follow = txt(comp, "follow for more AE tricks", { font: "body", size: 30, color: C.ink2, pos: [CX, 1410] });
    charIn(follow, 1.55, { words: true, stagger: 0.06, dur: 0.25, y: 30 });
    save.threeDLayer = true;
    follow.threeDLayer = true;
  }

  // ---------------------------------------------------------------------------
  // Main edit, transitions, guides and the 16:9 version
  // ---------------------------------------------------------------------------

  function buildMain(sceneComps) {
    var total = 0;
    for (var i = 0; i < SCENES.length; i++) total += SCENES[i].dur;
    var main = newComp("KVFX Promo \u00B7 MAIN 9x16", total, FOLDERS.root, C.ink);

    var music = null;
    var exts = ["mp3", "wav", "m4a", "aac"];
    for (var m = 0; m < exts.length && !music; m++) music = footage("music." + exts[m]);
    if (music) {
      var ml = main.layers.add(music);
      ml.name = "Music";
    }

    var cuts = [];
    var t = 0;
    for (var s = 0; s < SCENES.length; s++) {
      var l = main.layers.add(sceneComps[s]);
      l.startTime = t;
      l.name = SCENES[s].name;
      if (s > 0) cuts.push(t);
      t += SCENES[s].dur;
    }

    // Whip blur and a flash on every cut.
    var whip = solid(main, C.ink, "Whip transitions");
    whip.adjustmentLayer = true;
    var dIdx = fx(whip, "ADBE Motion Blur", "Whip", [[1, 0], [2, 0]]);
    var tIdx = fx(whip, "ADBE Geometry2", "Whip push");
    for (var c = 0; c < cuts.length; c++) {
      var ct = cuts[c];
      anim(fxProp(whip, dIdx, 2), [[ct - 3 * FD, 0], [ct, 120], [ct + 4 * FD, 0]], "snap");
      if (tIdx) {
        anim(fxProp(whip, tIdx, 2), [[ct - 3 * FD, [CX, CY]], [ct, [CX, CY - 140]], [ct + 4 * FD, [CX, CY]]], "snap");
      }
      flash(main, ct, C.white, 2, 60);
    }

    var grain = solid(main, C.ink, "Grain");
    grain.adjustmentLayer = true;
    fx(grain, "ADBE Noise", "Grain", [[1, CFG.grain], [2, 0]]);

    // Guides: they never render.
    var safe = shape(main, "Reels safe area (guide)");
    rectGroup(safe, "safe", 880, 1290, 0, [0, 0], null, C.pink, 4);
    setPos(safe, [80 + 440, 250 + 645]);
    safe.guideLayer = true;

    var beats = nul(main, "Beat grid " + CFG.bpm + " BPM (guide)", [CX, CY]);
    beats.guideLayer = true;
    var beat = 60 / CFG.bpm;
    var mk = beats.property("ADBE Marker");
    for (var b = 0, n = 0; b < total; b += beat, n++) {
      mk.setValueAtTime(b, new MarkerValue(n % 4 === 0 ? "bar " + (n / 4 + 1) : ""));
    }
    var sceneMarks = nul(main, "Scenes (guide)", [CX, CY]);
    sceneMarks.guideLayer = true;
    var acc = 0;
    for (var q = 0; q < SCENES.length; q++) {
      sceneMarks.property("ADBE Marker").setValueAtTime(acc, new MarkerValue(SCENES[q].name));
      acc += SCENES[q].dur;
    }
    return main;
  }

  function buildYoutube(main) {
    var yt = app.project.items.addComp("KVFX Promo \u00B7 YouTube 16x9", 1920, 1080, 1, main.duration, CFG.fps);
    yt.parentFolder = FOLDERS.root;
    yt.bgColor = C.ink;
    var back = yt.layers.add(main);
    back.name = "Backdrop";
    setScale(back, 1920 / W * 100 * 1.05);
    blurLayer(back, 80);
    var dim = solid(yt, C.ink, "Dim");
    tr(dim, "ADBE Opacity").setValue(55);
    var front = yt.layers.add(main);
    front.name = "Vertical edit";
    setScale(front, 1080 / H * 100);
    dropShadow(front, 0, 120);
    return yt;
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  function build() {
    if (!app.project) app.newProject();
    ASSET_DIR = findAssetDir();
    pickFonts();
    makeFolders();

    var dash = newComp("Part \u00B7 SaaS Dashboard", 11.0, FOLDERS.parts, C.paper, DASH_W, DASH_H);
    buildDashboard(dash);
    var tileBuilders = [buildTileType, buildTileLowerThird, buildTileExtrude, buildTileLabels];
    var tileNames = ["Kinetic Type", "Lower Third", "3D Extrude", "Labels"];
    var tiles = [];
    for (var t = 0; t < tileBuilders.length; t++) {
      var tc = newComp("Part \u00B7 Tile " + tileNames[t], 8.0, FOLDERS.parts, C.ink2, TILE_W, TILE_H);
      tileBuilders[t](tc);
      tiles.push(tc);
    }

    var builders = {
      hook: buildHook,
      brand: buildBrand,
      panel: buildPanel,
      anime: buildAnime,
      saas: function (c) { buildSaas(c, dash); },
      mograph: function (c) { buildMograph(c, tiles); },
      features: buildFeatures,
      cta: buildCta
    };
    var sceneComps = [];
    for (var s = 0; s < SCENES.length; s++) {
      var sc = newComp("Scene \u00B7 " + SCENES[s].name, SCENES[s].dur, FOLDERS.scenes, C.ink);
      builders[SCENES[s].key](sc);
      sceneComps.push(sc);
    }

    var main = buildMain(sceneComps);
    if (CFG.youtubeVersion) buildYoutube(main);
    main.openInViewer();
    return main;
  }

  function report(main) {
    var lines = ["KVFX promo built: " + main.name + " (" + main.duration + " s, " + W + "x" + H + ")."];
    if (MISSING.length) {
      lines.push("");
      lines.push("Missing assets (placeholders used - see promo/README.md):");
      for (var i = 0; i < MISSING.length; i++) lines.push("  - assets/" + MISSING[i]);
    }
    if (FONT_NOTES.length) {
      lines.push("");
      lines.push("Fonts:");
      for (var f = 0; f < FONT_NOTES.length; f++) lines.push("  - " + FONT_NOTES[f]);
    }
    if (WARN.length) {
      lines.push("");
      lines.push("Notes (" + WARN.length + "):");
      for (var w = 0; w < WARN.length && w < 12; w++) lines.push("  - " + WARN[w]);
      if (WARN.length > 12) lines.push("  - ...and " + (WARN.length - 12) + " more");
    }
    alert(lines.join("\n"), "KVFX Promo Builder");
  }

  app.beginUndoGroup("Build KVFX Promo");
  var built = null;
  try {
    built = build();
  } catch (e) {
    alert("The promo build stopped: " + errText(e) + (e.line ? " (line " + e.line + ")" : "") + "\nEdit > Undo removes the partial build.", "KVFX Promo Builder");
  } finally {
    app.endUndoGroup();
  }
  if (built) report(built);
})();
