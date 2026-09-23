# Troubleshooting

## The panel is missing from Window ▸ Extensions

Almost always CEP debug mode (INSTALL.md step 1). Check in order:

1. `PlayerDebugMode` is set for the right CSXS version — **CSXS.12** for
   After Effects 26.x, CSXS.11 for 22–25.
2. On Windows it must be a **string** value, not a DWORD.
3. After Effects was restarted after the change.
4. The link exists and points at `build/extension/com.kvfx.tools`.
5. `CSXS/manifest.xml` is present inside that folder — a partial build will not
   register.

## The panel opens blank

The UI failed to load. Open the panel, then browse to `http://localhost:8099` in
a Chromium browser for the panel's dev tools and read the console.

The usual cause is CSS or JavaScript newer than Chromium 99, which is what the
CEP 12 engine provides (F3). `npm run guard:css` catches the CSS side; for
JavaScript, confirm the Vite build target is still `chrome99`.

## "After Effects could not evaluate the request"

The host bundle did not load, so `$.global.__kvfxHost` does not exist. Either
`host/kvfx-host.jsx` is missing from the extension folder, or it failed to parse.

A parse failure means ES6 syntax reached an ES3 interpreter. Run:

```bash
npm run build:host && npm run guard:es3
```

Closing and reopening the panel reloads the host script, which is the fastest
way to recover after a rebuild.

## "Panel speaks protocol N, host speaks M"

The panel and the host bundle came from different builds — normally a partial
copy, or a stale link. Rebuild and re-assemble:

```bash
npm run clean && npm run build && npm run dev:link
```

## After Effects freezes while a command runs

Expected in kind, not in duration: ExtendScript runs on After Effects' main
thread, so the host call blocks the whole application (F10). Every request
carries a wall-clock budget and the host reports an overrun as
`budget_exceeded` rather than hiding it.

If you see `budget_exceeded` regularly, that is a real performance bug — please
report it with the diagnostic details and the project size.

## The panel shows stale layer or composition information

By design. After Effects emits no selection or document events at all (F4), and
polling for them is documented to destabilise large projects. The panel refreshes
when it regains focus and when you press the refresh control, and every command
re-reads the selection at the moment it executes — so a stale display never
causes a command to act on the wrong layer (ADR-0002).

## `dev:link` fails on Windows with EPERM

Symlink creation needs Developer Mode (**Settings ▸ System ▸ For developers**)
or an elevated terminal.

## `dev:link` says the platform is unsupported

You are on Linux. After Effects does not run there. Building and testing work
fine; installing the panel does not.

## Reporting a problem

Use **Show details ▸ Copy diagnostic info** in the panel's error view. The
bundle contains the KVFX version, After Effects version, OS, the command and
operation ids, the structured error and a diagnostic id.

It deliberately contains **no project content** — no layer names, no file paths,
no expression text. If you want to include context, the opt-in toggle shows you
exactly what will be added before you copy it.
