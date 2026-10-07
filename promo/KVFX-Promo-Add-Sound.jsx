/*
 * KVFX Tools - Promo Sound
 *
 * Adds the music and every sound effect to the promo's MAIN comp, each one on
 * the frame where its moment happens, and snaps the scene cuts onto the beat
 * of the track.
 *
 * Run it on a project that already has the promo: File > Scripts > Run Script
 * File... It works on "KVFX Promo \u00B7 MAIN 9x16" - the open one if that is the
 * comp in the viewer, otherwise the newest one in the project. It reads the
 * scene layers in MAIN by name, so the sound follows the scenes even if you
 * moved them. KVFX-Promo-Builder.jsx also runs it by itself after a build.
 *
 * Safety
 *   - It adds layers to MAIN and, if you agree, moves the scene layers and
 *     their cut flashes and whips by at most a beat (about 0.25 s here).
 *   - Sound layers it added on an earlier run are replaced only after asking.
 *   - Nothing outside MAIN changes except its length and the 16:9 comp's.
 *     One Edit > Undo removes the whole run.
 *
 * Plain ExtendScript (ES3).
 */

(function kvfxPromoSound() {

  var SOUND = {
    music: "music/phonk-move.mp3",
    musicTitle: "Phonk Move (Boomopera)",
    bpm: 122,
    // Track times, measured from the file: the first beat, the first drop's
    // downbeat and the second drop's downbeat.
    firstBeat: 0.25,
    drop: 8.118,
    drop2: 63.2,
    // The first drop lands on the CHEAT CODE slam.
    dropScene: "Hook",
    dropAt: 0.75,
    musicDb: -10,
    fadeOut: 0.6
  };

  var HOOK = "Hook";
  var BRAND = "Brand Sting";
  var PANEL = "Inside The Panel";
  var ANIME = "Anime Edits";
  var SAAS = "SaaS Promo";
  var MOGRAPH = "Everyday Mograph";
  var WALL = "Feature Wall";
  var CTA = "Call To Action";
  var MUSIC = "MUSIC";

  // Where in each file the moment is, so it can sit exactly on its frame:
  // whooshes by their peak, risers by their hit.
  var ALIGN = {
    "whoosh-01.wav": 0.28, "whoosh-02.wav": 0.17, "whoosh-03.wav": 0.14, "whoosh-04.wav": 0.30,
    "whoosh-05.wav": 0.61, "whoosh-06.wav": 0.42, "whoosh-07.wav": 0.18, "whoosh-08.wav": 0.87,
    "whoosh-09.wav": 0.20, "whoosh-10.wav": 0.12,
    "riser-hit-1.wav": 1.67, "riser-hit-2.wav": 2.40, "riser-hit-3.wav": 4.03, "riser-noise.wav": 1.54,
    "ui-glass-click.wav": 0.10, "hit-laser.wav": 0.02,
    "key-tap-1.wav": 0.01, "key-tap-2.wav": 0.01, "key-tap-3.wav": 0.01, "key-press.wav": 0.01
  };

  // [scene, seconds into the scene, file, dB, what it is]
  var CUES = [];
  function cue(scene, at, file, db, what) {
    CUES.push([scene, at, file, db, what]);
  }
  var i;

  cue(HOOK, 0.15, "ui-glass-click.wav", -12, "panel clicks under the hook");
  cue(HOOK, 0.35, "hit-bass.wav", -10, "AFTER EFFECTS slam");
  cue(HOOK, 0.75, "hit-reverb.wav", -9, "CHEAT CODE slam, on the drop");
  cue(HOOK, 1.4, "ui-08.wav", -8, "sticker pops");

  cue(BRAND, 0.3, "whoosh-06.wav", -9, "logo spins in");
  cue(BRAND, 0.3, "hit-metal.wav", -13, "logo lands");
  cue(BRAND, 1.25, "ui-03.wav", -10, "badges");

  cue(PANEL, 0.2, "whoosh-02.wav", -10, "Ease tab slides in");
  cue(PANEL, 0.3, "ui-08.wav", -10, "chip");
  cue(PANEL, 0.6, "ui-glass-click.wav", -4, "grabs handle 1");
  cue(PANEL, 1.4, "ui-03.wav", -15, "lets go");
  cue(PANEL, 1.95, "ui-glass-click.wav", -4, "grabs handle 2");
  cue(PANEL, 2.6, "ui-03.wav", -15, "lets go");
  cue(PANEL, 4.05, "ui-02.wav", -8, "picks Back");
  cue(PANEL, 5.05, "ui-glass-click.wav", -2, "Apply to Keys");
  cue(PANEL, 5.1, "ui-13.wav", -10, "toast");
  cue(PANEL, 5.4, "whoosh-09.wav", -9, "to the Text tab");
  cue(PANEL, 5.42, "ui-08.wav", -10, "zoom pops");
  cue(PANEL, 5.6, "ui-09.wav", -12, "chip");
  for (i = 0; i < 8; i++) cue(PANEL, 5.47 + i * 0.37, "ui-03.wav", -14, "text preset " + (i + 1));
  cue(PANEL, 5.47 + 8 * 0.37, "whoosh-10.wav", -12, "TRACK IN");
  cue(PANEL, 5.47 + 9 * 0.37, "whoosh-07.wav", -12, "ZOOM OUT");
  cue(PANEL, 9.2, "whoosh-01.wav", -9, "to Search");
  cue(PANEL, 9.22, "ui-02.wav", -10, "panel pops");
  cue(PANEL, 9.25, "ui-03.wav", -12, "CTRL key pops");
  cue(PANEL, 9.32, "ui-03.wav", -12, "SPACE key pops");
  cue(PANEL, 9.55, "key-press.wav", 0, "Ctrl + Space");
  cue(PANEL, 10.1, "key-tap-1.wav", 0, "types m");
  cue(PANEL, 10.2, "ui-09.wav", -12, "chip");
  cue(PANEL, 10.35, "key-tap-2.wav", 0, "types t");
  cue(PANEL, 10.6, "key-tap-3.wav", 0, "types t");
  cue(PANEL, 11.7, "key-press.wav", 0, "Enter");
  cue(PANEL, 11.75, "ui-13.wav", -10, "toast");

  cue(ANIME, 0, "riser-hit-2.wav", -12, "riser into ANIME EDITS");
  cue(ANIME, 0.85, "whoosh-02.wav", -10, "title whips up");
  cue(ANIME, 1.25, "ui-08.wav", -10, "chip");
  cue(ANIME, 2.0, "hit-bass.wav", -8, "hero drops");
  cue(ANIME, 3.5, "hit-laser.wav", -10, "eye punch");
  cue(ANIME, 3.5, "ui-12.wav", -15, "chromatic glitch");
  cue(ANIME, 3.65, "ui-09.wav", -12, "chip");
  cue(ANIME, 5.0, "whoosh-06.wav", -10, "camera orbit");
  cue(ANIME, 5.15, "ui-08.wav", -12, "chip");
  cue(ANIME, 5.25, "whoosh-07.wav", -13, "Ease tab slides in");
  cue(ANIME, 7.18, "whoosh-05.wav", -6, "leap");
  cue(ANIME, 7.25, "hit-laser-explosion.wav", -8, "impact");
  cue(ANIME, 9.15, "whoosh-03.wav", -12, "lyric builds");
  cue(ANIME, 9.2, "ui-08.wav", -12, "chip");
  cue(ANIME, 10.35, "riser-noise.wav", -12, "lyric explodes");
  cue(ANIME, 10.35, "boom-low.wav", -14, "explosion low end");
  for (i = 0; i < 4; i++) cue(ANIME, 11.0 + i * 0.1, "ui-03.wav", -13, "carousel card " + (i + 1));
  cue(ANIME, 11.15, "ui-09.wav", -12, "chip");
  cue(ANIME, 11.3, "whoosh-08.wav", -10, "carousel spins");
  cue(ANIME, 12.0, "ui-08.wav", -12, "chip");

  cue(SAAS, 0, "riser-hit-1.wav", -12, "riser into SAAS PROMOS");
  cue(SAAS, 0.85, "whoosh-02.wav", -10, "title whips up");
  cue(SAAS, 1.2, "whoosh-06.wav", -11, "dashboard tilts in");
  for (i = 0; i < 3; i++) cue(SAAS, 1.25 + i * 0.1, "ui-02.wav", -12, "KPI card " + (i + 1));
  cue(SAAS, 1.3, "ui-08.wav", -12, "chip");
  cue(SAAS, 1.5, "ui-glass-click.wav", -8, "clicks the To field");
  for (i = 0; i < 5; i++) cue(SAAS, 1.7 + i * 0.1, "key-tap-" + (i % 3 + 1) + ".wav", -4, "types 48920");
  cue(SAAS, 2.9, "ui-09.wav", -12, "chip");
  for (i = 0; i < 3; i++) cue(SAAS, 3.0 + i * 0.09, "ui-03.wav", -14, "signup row " + (i + 1));
  cue(SAAS, 3.4, "ui-glass-click.wav", -6, "clicks Sequence Layers");
  cue(SAAS, 4.5, "ui-08.wav", -12, "chip");
  cue(SAAS, 4.75, "whoosh-10.wav", -10, "cards snap into line");
  cue(SAAS, 4.9, "ui-01.wav", -10, "aligned");
  cue(SAAS, 5.6, "ui-glass-click.wav", -4, "clicks Upgrade");
  cue(SAAS, 5.65, "ui-10.wav", -12, "ripple");
  cue(SAAS, 6.1, "ui-09.wav", -12, "chip");
  cue(SAAS, 6.4, "whoosh-07.wav", -12, "bars grow");
  cue(SAAS, 7.5, "ui-08.wav", -12, "chip");
  cue(SAAS, 7.6, "key-typing.wav", -2, "headline types on");
  cue(SAAS, 9.0, "ui-09.wav", -12, "chip");
  cue(SAAS, 9.35, "whoosh-04.wav", -8, "versions split");
  for (i = 0; i < 3; i++) cue(SAAS, 9.5 + i * 0.1, "ui-03.wav", -12, "version label " + (i + 1));

  cue(MOGRAPH, 0, "hit-metal.wav", -13, "EVERYDAY MOGRAPH");
  cue(MOGRAPH, 0.85, "whoosh-02.wav", -10, "title whips up");
  for (i = 0; i < 4; i++) cue(MOGRAPH, 1.0 + i * 0.1, "ui-02.wav", -12, "tile " + (i + 1));
  for (i = 0; i < 4; i++) cue(MOGRAPH, 1.5 + i * 0.2, "ui-03.wav", -13, "tile chip " + (i + 1));
  cue(MOGRAPH, 5.55, "whoosh-04.wav", -10, "tiles fly out");
  cue(MOGRAPH, 5.6, "ui-08.wav", -12, "panels pop");
  cue(MOGRAPH, 6.2, "whoosh-09.wav", -10, "file flies in");
  cue(MOGRAPH, 6.35, "ui-13.wav", -10, "file dropped");
  cue(MOGRAPH, 6.8, "ui-09.wav", -12, "chip");

  cue(WALL, 0.15, "hit-bass.wav", -12, "8 TABS");
  cue(WALL, 0.5, "hit-metal.wav", -12, "100+ COMMANDS");
  cue(WALL, 0.85, "hit-overdrive.wav", -15, "1 SHORTCUT");
  cue(WALL, 1.2, "ui-03.wav", -12, "CTRL key pops");
  cue(WALL, 1.3, "ui-03.wav", -12, "SPACE key pops");
  cue(WALL, 1.5, "key-press.wav", 0, "Ctrl + Space");
  cue(WALL, 2.25, "whoosh-06.wav", -9, "headlines whip up");
  for (i = 0; i < 3; i++) cue(WALL, 2.3 + i * 0.15, "ui-02.wav", -14, "tabs fan out " + (i + 1));
  cue(WALL, 3.0, "ui-08.wav", -10, "palette pops");
  cue(WALL, 3.3, "ui-09.wav", -12, "chip");

  cue(MUSIC, SOUND.drop2, "riser-hit-3.wav", -11, "riser into the second drop");
  cue(MUSIC, SOUND.drop2, "hit-reverb.wav", -10, "second drop");

  cue(CTA, 0.12, "ui-08.wav", -8, "logo pops");
  cue(CTA, 0.4, "ui-03.wav", -10, "NEW sticker");
  cue(CTA, 0.9, "ui-09.wav", -8, "LINK IN BIO");

  // A whoosh peaking on every cut, in scene order (the first scene has none).
  var CUT_WHOOSH = ["whoosh-04.wav", "whoosh-01.wav", "whoosh-06.wav", "whoosh-04.wav", "whoosh-01.wav", "whoosh-06.wav", "whoosh-05.wav"];
  var CUT_DB = -9;

  // ---------------------------------------------------------------------------

  var AUTO = $.global.__kvfxSound || null;
  var MAIN_PREFIX = "KVFX Promo \u00B7 MAIN";
  var YT_PREFIX = "KVFX Promo \u00B7 YouTube";
  var SFX_PREFIX = "SFX \u00B7 ";
  var MUSIC_PREFIX = "Music \u00B7 ";
  var LABELS = { hit: 1, riser: 10, whoosh: 14, ui: 2, key: 8, music: 9 };
  var notes = [];
  var missing = [];

  function errText(e) {
    return e && e.message ? e.message : String(e);
  }

  function startsWith(s, p) {
    return String(s).substr(0, p.length) === p;
  }

  function sceneKey(name) {
    return String(name).replace(/^\d+\s+/, "").toLowerCase();
  }

  function findMain() {
    var active = app.project.activeItem;
    if (active && active instanceof CompItem && startsWith(active.name, MAIN_PREFIX)) return active;
    var found = null;
    for (var k = 1; k <= app.project.numItems; k++) {
      var it = app.project.item(k);
      if (it instanceof CompItem && startsWith(it.name, MAIN_PREFIX)) {
        if (!found || it.id > found.id) found = it;
      }
    }
    return found;
  }

  function assetDir() {
    if (AUTO && AUTO.assetDir) return AUTO.assetDir;
    try {
      var d = new Folder(new File($.fileName).parent.fsName + "/assets");
      if (d.exists) return d;
    } catch (e) {
      // Fall through to asking.
    }
    return Folder.selectDialog("Pick the KVFX promo \"assets\" folder");
  }

  var ASSETS = null;
  var ITEMS = {};
  var soundFolder = null;

  function importAudio(rel) {
    if (ITEMS.hasOwnProperty(rel)) return ITEMS[rel];
    var f = new File(ASSETS.fsName + "/" + rel);
    var item = null;
    if (f.exists) {
      for (var k = 1; k <= app.project.numItems && !item; k++) {
        var it = app.project.item(k);
        if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) item = it;
      }
      if (!item) {
        try {
          item = app.project.importFile(new ImportOptions(f));
          if (soundFolder) item.parentFolder = soundFolder;
        } catch (e) {
          notes.push("Could not import " + rel + ": " + errText(e));
          item = null;
        }
      }
    } else {
      missing.push(rel);
    }
    ITEMS[rel] = item;
    return item;
  }

  function levels(l) {
    return l.property("ADBE Audio Group").property("ADBE Audio Levels");
  }

  function categoryOf(file) {
    if (startsWith(file, "whoosh")) return "whoosh";
    if (startsWith(file, "riser")) return "riser";
    if (startsWith(file, "ui")) return "ui";
    if (startsWith(file, "key")) return "key";
    return "hit";
  }

  function ease(p, mode) {
    for (var k = 1; k <= p.numKeys; k++) {
      if (mode === "linear") {
        p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
      } else {
        var d = p.propertyValueType === PropertyValueType.TwoD ? 2 : p.propertyValueType === PropertyValueType.ThreeD ? 3 : 1;
        var a = [];
        var b = [];
        for (var n = 0; n < d; n++) {
          a.push(new KeyframeEase(0, 90));
          b.push(new KeyframeEase(0, 8));
        }
        p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        p.setTemporalEaseAtKey(k, a, b);
      }
    }
  }

  function clearKeys(p) {
    while (p.numKeys > 0) p.removeKey(p.numKeys);
  }

  // ---------------------------------------------------------------------------

  function run() {
    var main = AUTO && AUTO.comp ? AUTO.comp : findMain();
    if (!main) {
      alert("No \"" + MAIN_PREFIX + " 9x16\" comp in this project. Build the promo first with KVFX-Promo-Builder.jsx.", "KVFX Promo Sound");
      return null;
    }
    var fd = main.frameDuration;
    var beat = 60 / SOUND.bpm;

    // Scene layers, in time order.
    var scenes = [];
    for (var k = 1; k <= main.numLayers; k++) {
      var l = main.layer(k);
      if (l.source instanceof CompItem && startsWith(l.source.name, "Scene \u00B7 ")) scenes.push(l);
    }
    scenes.sort(function (a, b) { return a.inPoint - b.inPoint; });
    if (scenes.length === 0) {
      alert("\"" + main.name + "\" has no scene layers (Scene \u00B7 \u2026). Nothing was added.", "KVFX Promo Sound");
      return null;
    }

    // Earlier sound layers.
    var old = [];
    for (var o = 1; o <= main.numLayers; o++) {
      var ol = main.layer(o);
      if (startsWith(ol.name, SFX_PREFIX) || startsWith(ol.name, MUSIC_PREFIX) || ol.name === "Music") old.push(ol);
    }
    if (old.length && !AUTO) {
      if (!confirm("\"" + main.name + "\" already has " + old.length + " KVFX sound layers. Replace them?", false, "KVFX Promo Sound")) return null;
    }
    var snap = AUTO ? true : confirm("Snap the scene cuts to the beat of " + SOUND.musicTitle + "?\n\nEach cut moves earlier by at most one beat (about 0.25 s) so it lands on the beat; the flash and whip at every cut move with it. Choose No to keep your cuts exactly where they are.", false, "KVFX Promo Sound");

    ASSETS = assetDir();
    if (!ASSETS) return null;
    for (var r = 0; r < old.length; r++) old[r].remove();

    // Where the drop lands in MAIN, and from it the beat grid.
    var dropScene = null;
    for (var s = 0; s < scenes.length; s++) if (sceneKey(scenes[s].name) === SOUND.dropScene.toLowerCase()) dropScene = scenes[s];
    var dropVideo = (dropScene ? dropScene.inPoint : scenes[0].inPoint) + SOUND.dropAt;
    var phase = dropVideo - Math.floor(dropVideo / beat) * beat;

    // The last beat at or before t, on a frame. Cuts sit on the nearest frame,
    // up to half a frame before the true beat, so allow that much - otherwise
    // a second run would snap every cut a whole beat earlier.
    function lastBeatBefore(t) {
      var n = Math.floor((t + fd / 2 - phase) / beat + 1e-6);
      var x = phase + n * beat;
      var f = Math.round(x / fd) * fd;
      if (f > t + 1e-6) f -= fd;
      return f;
    }

    var oldStarts = [];
    var newStarts = [];
    for (s = 0; s < scenes.length; s++) {
      oldStarts.push(scenes[s].inPoint);
      newStarts.push(scenes[s].inPoint);
    }
    if (snap) {
      var cursor = scenes[0].inPoint;
      for (s = 0; s < scenes.length; s++) {
        var sc = scenes[s];
        var length = sc.outPoint - sc.inPoint;
        var end = lastBeatBefore(cursor + length);
        if (end - cursor < length * 0.5) end = cursor + length;
        try {
          sc.startTime += cursor - sc.inPoint;
          sc.outPoint = end;
        } catch (e) {
          notes.push("Could not move " + sc.name + ": " + errText(e));
        }
        newStarts[s] = cursor;
        cursor = end;
      }
      main.duration = cursor;
      moveTransitions(main, oldStarts, newStarts, fd);
      for (var y = 1; y <= app.project.numItems; y++) {
        var yt = app.project.item(y);
        if (yt instanceof CompItem && startsWith(yt.name, YT_PREFIX) && yt.parentFolder === main.parentFolder) yt.duration = main.duration;
      }
    }
    retagGuides(main, scenes, phase, beat, dropVideo);

    // A folder for the sound, beside the scenes.
    soundFolder = null;
    var parent = main.parentFolder;
    for (var q = 1; q <= parent.numItems; q++) {
      if (parent.item(q) instanceof FolderItem && parent.item(q).name === "04 Sound") soundFolder = parent.item(q);
    }
    if (!soundFolder) {
      soundFolder = app.project.items.addFolder("04 Sound");
      soundFolder.parentFolder = parent;
    }

    // Music: the drop on the slam, faded out at the end.
    var placed = 0;
    var musicItem = importAudio(SOUND.music);
    if (musicItem) {
      var ml = main.layers.add(musicItem);
      ml.name = MUSIC_PREFIX + SOUND.musicTitle;
      ml.label = LABELS.music;
      ml.startTime = dropVideo - SOUND.drop;
      ml.inPoint = 0;
      ml.outPoint = main.duration;
      var lv = levels(ml);
      lv.setValuesAtTimes([main.duration - SOUND.fadeOut, main.duration], [[SOUND.musicDb, SOUND.musicDb], [-48, -48]]);
      ease(lv, "linear");
      ml.moveToEnd();
      placed++;
    }

    var musicStart = dropVideo - SOUND.drop;
    function sceneStart(name) {
      for (var n = 0; n < scenes.length; n++) {
        if (sceneKey(scenes[n].name) === name.toLowerCase()) return [scenes[n].inPoint, scenes[n].outPoint - scenes[n].inPoint];
      }
      return null;
    }

    function place(file, t, db, what) {
      var item = importAudio("sfx/" + file);
      if (!item) return;
      var l = main.layers.add(item);
      l.startTime = t - (ALIGN.hasOwnProperty(file) ? ALIGN[file] : 0);
      l.name = SFX_PREFIX + what;
      l.label = LABELS[categoryOf(file)];
      try {
        levels(l).setValue([db, db]);
      } catch (e) {
        notes.push("Level on " + l.name + ": " + errText(e));
      }
      l.moveToEnd();
      placed++;
    }

    var skipped = 0;
    for (var c = 0; c < CUES.length; c++) {
      var cu = CUES[c];
      var t;
      if (cu[0] === MUSIC) {
        t = musicStart + cu[1];
      } else {
        var info = sceneStart(cu[0]);
        // A cue past a scene's (snapped) end, or for a scene this build lacks.
        if (!info || cu[1] > info[1] + 0.02) {
          skipped++;
          continue;
        }
        t = info[0] + cu[1];
      }
      if (t < 0 || t > main.duration) {
        skipped++;
        continue;
      }
      place(cu[2], t, cu[3], cu[4]);
    }
    for (s = 1; s < scenes.length; s++) {
      place(CUT_WHOOSH[(s - 1) % CUT_WHOOSH.length], scenes[s].inPoint, CUT_DB, "cut into " + sceneKey(scenes[s].name));
    }

    var lines = [placed + " sound layers added to \"" + main.name + "\" (" + main.duration.toFixed(2) + " s)."];
    lines.push("Music starts " + (-musicStart).toFixed(2) + " s into the track, so its drop lands on the CHEAT CODE slam.");
    if (snap) lines.push("Scene cuts snapped to the " + SOUND.bpm + " BPM beat.");
    if (skipped) lines.push(skipped + " cues skipped (their scene is shorter or missing in this build).");
    if (missing.length) {
      var shown = missing.length > 4 ? missing.slice(0, 4).join(", ") + " and " + (missing.length - 4) + " more" : missing.join(", ");
      lines.push("Not found in " + ASSETS.fsName + ": " + shown + ". Put the kit's music and sfx folders there and run this again.");
    }
    for (var nn = 0; nn < notes.length && nn < 8; nn++) lines.push(notes[nn]);
    return lines.join("\n");
  }

  // Flashes and whip keys sat on the old cuts; put them on the new ones.
  function moveTransitions(main, oldStarts, newStarts, fd) {
    var cx = main.width / 2;
    var cy = main.height / 2;
    for (var k = 1; k <= main.numLayers; k++) {
      var l = main.layer(k);
      if (l.name !== "Flash") continue;
      for (var s = 1; s < oldStarts.length; s++) {
        if (Math.abs(l.inPoint - oldStarts[s]) < 0.05) {
          l.startTime += newStarts[s] - oldStarts[s];
          break;
        }
      }
    }
    var whip = null;
    for (var w = 1; w <= main.numLayers; w++) if (main.layer(w).name === "Whip transitions") whip = main.layer(w);
    if (!whip) return;
    try {
      var fx = whip.property("ADBE Effect Parade");
      var blur = fx.property("Whip") ? fx.property("Whip").property(2) : null;
      var push = fx.property("Whip push") ? fx.property("Whip push").property(2) : null;
      if (blur) clearKeys(blur);
      if (push) clearKeys(push);
      for (var c = 1; c < newStarts.length; c++) {
        var ct = newStarts[c];
        if (blur) blur.setValuesAtTimes([ct - 3 * fd, ct, ct + 4 * fd], [0, 120, 0]);
        if (push) push.setValuesAtTimes([ct - 3 * fd, ct, ct + 4 * fd], [[cx, cy], [cx, cy - 140], [cx, cy]]);
      }
      if (blur) ease(blur, "snap");
      if (push) ease(push, "snap");
    } catch (e) {
      notes.push("Whip transitions: " + errText(e));
    }
  }

  // The guide layers: scene markers on the new cuts, a beat grid for the track.
  function retagGuides(main, scenes, phase, beat, dropVideo) {
    for (var k = 1; k <= main.numLayers; k++) {
      var l = main.layer(k);
      var mk = l.property("ADBE Marker");
      if (!mk) continue;
      if (startsWith(l.name, "Scenes (guide)")) {
        clearKeys(mk);
        for (var s = 0; s < scenes.length; s++) mk.setValueAtTime(scenes[s].inPoint, new MarkerValue(scenes[s].name));
      } else if (startsWith(l.name, "Beat grid")) {
        clearKeys(mk);
        l.name = "Beat grid " + SOUND.bpm + " BPM (guide)";
        // Bars counted the way the track counts them (the drop is bar 5).
        var first = Math.ceil((0 - phase) / beat);
        for (var n = first; phase + n * beat < main.duration; n++) {
          var t = phase + n * beat;
          if (t < 0) continue;
          var fromDrop = Math.round((t - dropVideo) / beat);
          var isBar = ((fromDrop % 4) + 4) % 4 === 0;
          mk.setValueAtTime(t, new MarkerValue(isBar ? "bar " + (Math.floor(fromDrop / 4) + 5) : ""));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------

  if (AUTO) {
    try {
      AUTO.result = run();
    } catch (e) {
      AUTO.result = "Sound was not added: " + errText(e) + (e.line ? " (line " + e.line + ")" : "");
    }
    return;
  }
  app.beginUndoGroup("Add KVFX Promo Sound");
  var report = null;
  try {
    report = run();
  } catch (e2) {
    alert("Adding the sound stopped: " + errText(e2) + (e2.line ? " (line " + e2.line + ")" : "") + "\nEdit > Undo removes what was added.", "KVFX Promo Sound");
  } finally {
    app.endUndoGroup();
  }
  if (report) alert(report, "KVFX Promo Sound");
})();
