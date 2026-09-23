# Installing KVFX Tools

> **Development install only.** Signed `.zxp` packaging and an installer are
> Phase 14 deliverables. Until then the panel is installed by linking a local
> build, which requires enabling CEP debug mode once per machine.

## 1. Enable CEP debug mode (once per machine)

After Effects refuses to load an unsigned extension unless this is set. It is a
one-time change and it affects only your user account.

**macOS**

```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

If you also run After Effects 22–25, repeat for `com.adobe.CSXS.11`.

**Windows**

Add a **string** value (not DWORD) named `PlayerDebugMode` with the value `1`
under `HKEY_CURRENT_USER\Software\Adobe\CSXS.12`, or run:

```bat
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

Restart After Effects afterwards.

## 2. Build and link

```bash
npm install
npm run build
npm run dev:link
```

`dev:link` creates a link in your per-user CEP extensions folder:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\Adobe\CEP\extensions\com.kvfx.tools` |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/com.kvfx.tools` |

It refuses to replace a real directory there, since that is almost certainly an
installed copy of KVFX Tools — remove or rename it yourself first.

On Windows, creating the link needs either Developer Mode
(**Settings ▸ System ▸ For developers**) or an elevated terminal. The script
says so if it fails.

## 3. Open the panel

**Window ▸ Extensions ▸ KVFX Tools**

The panel checks its connection to After Effects on load and reports the host
version, build, ExtendScript engine and round-trip time. A green dot means the
bridge works end to end.

## Where your data lives

KVFX Tools never writes user data into its install directory, so updating or
removing the extension cannot take your presets with it.

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\KVFXTools\` |
| macOS | `~/Library/Application Support/KVFXTools/` |

## Uninstalling a development install

Delete the link created in step 2. That removes the panel and nothing else; your
user data directory is left alone, and you can delete it separately if you want
a clean slate.
