# Setup helpers

One-time scripts that let After Effects load an **unsigned** extension. KVFX
Tools is not code-signed yet — signing is a Phase 14 deliverable — so this step
is required until then, and these scripts exist so nobody has to paste registry
commands by hand.

Everything here is **per-user and reversible**. Nothing needs administrator
rights, and each `enable` script has a matching `disable`.

| Platform | Enable | Undo |
|---|---|---|
| Windows | `windows/enable-cep-debug.reg` | `windows/disable-cep-debug.reg` |
| macOS | `macos/enable-cep-debug.command` | `macos/disable-cep-debug.command` |

## What it actually changes

`PlayerDebugMode` is Adobe's documented developer switch. With it set, After
Effects stops requiring a valid signature on CEP extensions.

* **Windows** — a `PlayerDebugMode` string value of `"1"` under
  `HKEY_CURRENT_USER\Software\Adobe\CSXS.12` and `…\CSXS.11`. `HKCU` is your
  account only; other users are unaffected.
* **macOS** — the same key written to `~/Library/Preferences/com.adobe.CSXS.12.plist`
  (and `.11`), then `cfprefsd` is killed so macOS reloads its plist cache — the
  remedy Adobe's own documentation gives.

CSXS.12 covers After Effects 26.x and CSXS.11 covers 22.x–25.x. Setting the one
you do not have installed does nothing.

It relaxes the signature requirement for Adobe extension loading and nothing
else. Once KVFX Tools ships signed, none of this will be needed.

## Running them

**Windows** — double-click the `.reg` file. Windows will ask for confirmation
before changing the registry; that prompt is expected. Quit and reopen After
Effects afterwards.

**macOS** — double-click the `.command` file. If macOS blocks it because it was
downloaded, right-click ▸ **Open** ▸ **Open**, which is the standard way to run
an unsigned script you trust. If it will not run at all, the files are short
enough to read, and the two commands can be pasted into Terminal directly:

```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

## Source

The values and the `cfprefsd` step are taken from Adobe's
[CEP 12 HTML Extension Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md),
not from memory.
