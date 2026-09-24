# Testing KVFX Tools

No build tools required. You need After Effects (22.0 or newer; 26.x is the
development target) and about five minutes.

A ready-to-install `KVFX-Tools-v0.1.0-dev.zip` is produced by `npm run build`
and lands in `build/`. If you were sent the zip directly, skip to step 2.

---

## Step 1 — Enable CEP debug mode (one time per machine)

After Effects refuses to load an **unsigned** extension unless this is set. Code
signing is a Phase 14 deliverable, so until then this step is required. It
affects only your user account and only Adobe extension loading.

**macOS** — paste into Terminal:

```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
killall cfprefsd
```

**Windows** — paste into Command Prompt:

```bat
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

Both versions are set because CSXS.12 covers After Effects 26 and CSXS.11 covers
22–25; setting the one you do not need is harmless.

**Quit and reopen After Effects afterwards.**

## Step 2 — Unzip into the extensions folder

Unzip so that the folder `com.kvfx.tools` sits directly inside `extensions`:

**macOS** — `~/Library/Application Support/Adobe/CEP/extensions/`

In Finder press `⇧⌘G` and paste `~/Library/Application Support/Adobe/CEP/extensions`.
If the `CEP` or `extensions` folders do not exist, create them, or run:

```bash
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
```

**Windows** — `%APPDATA%\Adobe\CEP\extensions\`

Paste that into the Explorer address bar. Create the folders if missing.

The result must look like this:

```
extensions/
└── com.kvfx.tools/
    ├── CSXS/manifest.xml
    ├── host/kvfx-host.jsx
    ├── assets/
    └── index.html
```

A common mistake is ending up with `extensions/com.kvfx.tools/com.kvfx.tools/`.
If `manifest.xml` is not exactly two levels down, the panel will not appear.

## Step 3 — Open the panel

In After Effects: **Window ▸ Extensions ▸ KVFX Tools**

---

## What you should see

A dark panel with a green dot and your After Effects version, a search field,
and a list of commands.

## What to check

Open any project with a few layers in a composition.

**1. It connects.** Green dot, correct After Effects version, round-trip time
under ~50 ms.

**2. It sees your selection.** Select two layers in the timeline, then click the
panel. The line under the status should read `<comp name> — 2 layers selected`.

It updates when the panel regains focus, not continuously — that is deliberate.
After Effects provides no selection events at all, and polling for them is a
documented way to hang large projects.

**3. Commands work.** Select a layer, click **Toggle Solo**. The solo switch
should flip in the timeline.

**4. Undo is one step.** Select three layers, run **Move to Top**, then press
`Ctrl/Cmd+Z` **once**. All three should return to their original positions, and
Edit ▸ Undo should read "KVFX Tools — Move to Top". This is the single most
important thing to verify.

**5. Search works.** Click the search field and try:

| Type | Expect first result |
|---|---|
| `null` | Create Null |
| `mtt` | Move to Top |
| `eye` | Toggle Visibility |
| `3d` | Toggle 3D |

Arrow keys move the selection, `Enter` runs, `Esc` clears.

**6. The palette shortcut.** Click the panel, then press `Cmd+Space` (macOS) or
`Ctrl+Space` (Windows). The search field should focus and select its contents.

This works **only while the panel has keyboard focus**. After Effects does not
let a script or a CEP panel register a global shortcut, so there is no way to
make it work while the timeline is focused. On macOS, `Cmd+Space` is also
Spotlight — if Spotlight opens instead, macOS took it first; that is expected,
and the shortcut will be configurable.

**7. Favourites persist.** Click the ☆ next to a command, close the panel,
reopen it. The star should still be filled, and that command should be at the
top of the list.

**8. Nothing selected.** Deselect everything. Layer commands should grey out
with "Select a layer first." rather than disappearing — and Create Null should
stay available.

---

## If something does not work

**Panel missing from the Extensions menu** — almost always step 1 or a wrong
folder depth. Check `manifest.xml` is exactly two levels below `extensions`, and
that After Effects was restarted after the registry/defaults change.

**Panel opens blank** — the UI failed to load. With the panel open, browse to
<http://localhost:8099> in Chrome or Edge for the panel's developer console.

**"After Effects could not evaluate the request"** — the host script did not
load. Close and reopen the panel, which reloads it.

Fuller symptom list: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## What to report back

Anything from the checklist that did not behave as described — especially
**item 4**, since a command that does not undo cleanly is a correctness bug
rather than a rough edge.

Screenshots of the panel are useful. So is the exact After Effects version from
**Help ▸ About After Effects**.

---

## Removing it

Delete the `com.kvfx.tools` folder from the extensions directory. That removes
the panel and nothing else.

Your settings live separately and are left alone:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\KVFXTools\` |
| macOS | `~/Library/Application Support/KVFXTools/` |

Delete that folder too for a completely clean slate.
