# Omi on Linux

Status: **MVP + screen-reading working** — builds, the focused Linux unit tests
pass (`linuxForeground` / `nativeForeground` / `foregroundMonitor` / Wayland
Rewind defaults), launches and renders on X11, and **screen OCR ("what's on my
screen") works** via a Tesseract-backed helper. App-usage / X11 active-window
parsing is unit-tested and wired into the poll monitor, but CI does **not** yet
runtime-smoke real `xprop` + `/proc` foreground detection under Xvfb — treat
that path as parser-covered, not end-to-end verified.

Architecture choice: Linux is a **platform seam on `desktop/windows`**, not a
forked `desktop/linux` / `desktop/Linux` tree. Shared renderer/main stay one
codebase; only OS-specific adapters branch on `process.platform`.

## Run from source
```bash
cd desktop/windows
cp .env.example .env          # public Firebase/PostHog config; sign-in works as-is
pnpm install --frozen-lockfile
pnpm run dev                   # launch on an X11 session (DISPLAY set)
```

## Runtime dependencies (Debian/Ubuntu)
```bash
sudo apt-get install -y x11-utils tesseract-ocr tesseract-ocr-eng
```
- `x11-utils` provides `xprop` — used for active-window detection (usage-tracking,
  and the OCR helper's window-info op).
- `tesseract-ocr` (+ the `eng` language pack) backs screen OCR. Without it, screen
  reading degrades gracefully (the helper returns an error frame; the rest of the
  app is unaffected).
- Packaged `.deb` depends on `tesseract-ocr`, `tesseract-ocr-eng`,
  `libnotify4`, `libxss1`, and `x11-utils` (for `xprop`). AppImage users still
  need the packages above. Fedora/RHEL `.rpm` packaging is in the next section.
- System-audio loopback (meeting capture) needs PulseAudio or `pipewire-pulse`.
  Chromium flag `PulseaudioLoopbackForScreenShare` is enabled on Linux; without
  a Pulse layer the flag is inert and capture falls back to mic-only.
- Headless/CI: run under `xvfb-run` and pass `--no-sandbox`.

## Runtime dependencies (Fedora / RHEL)
```bash
sudo dnf install -y xprop tesseract tesseract-langpack-eng
```
- `xprop` is the same binary Debian packages as `x11-utils`. Older RHEL
  still ships it as `xorg-x11-utils`; the RPM `Requires` accepts either.
- `tesseract` + `tesseract-langpack-eng` back screen OCR (Debian's
  `tesseract-ocr` / `tesseract-ocr-eng`).
- Packaged `.rpm` Depends on those plus Electron's GTK/NSS runtime set
  (`gtk3`, `nss`, `libnotify`, `libXScrnSaver`, …). AppImage users still
  need the packages above. openSUSE package names differ (`tesseract-ocr`);
  that distro is not a first-class RPM target yet.

## Runtime dependencies (Arch)
```bash
sudo pacman -S --needed libxcrypt-compat tesseract xorg-xprop
```
- `libxcrypt-compat` provides the legacy `libcrypt.so.1` SONAME. Arch's
  `libxcrypt` package only ships `libcrypt.so.2` by default, but Electron's
  bundled Node/Chromium binaries still expect `libcrypt.so.1` — without it the
  app fails to launch at all. This isn't Omi-specific (Mattermost Desktop and
  other Electron apps hit the same gap on Arch).

## Runtime dependencies (Fedora / Asahi aarch64 AppImage)
```bash
sudo dnf install zlib-devel fuse
```
- **AppImage on aarch64** (including Fedora Asahi Remix): the AppImage *runtime*
  stub is linked against unversioned `libz.so`, which Fedora only ships in
  `zlib-devel` (runtime packages provide `libz.so.1`). Without it, the AppImage
  prints `error while loading shared libraries: libz.so` and exits before Omi
  starts — GUI launches fail silently. Same class of bug as
  [AppImageKit#1092](https://github.com/AppImage/AppImageKit/issues/1092) /
  Beekeeper Studio on Asahi.
- `fuse` (or `fuse3` + compatibility) is required for AppImage mounting.
- Prefer the `.deb` artifact on Debian/Ubuntu; on Fedora Asahi the AppImage +
  `zlib-devel` path above is the usual local-dev route. One-shot symlink if you
  cannot install devel packages:
  `sudo ln -sf /usr/lib64/libz.so.1 /usr/lib64/libz.so`

### Build packaged Linux binaries (Fedora / Asahi)
```bash
# Recommended on Fedora Asahi — AppImage only (skips deb/rpm):
pnpm run build:linux:appimage

# Full AppImage + deb + rpm (needs rpm-build for the rpm target):
sudo dnf install -y rpm-build
pnpm run build:linux
```
- `pnpm build:linux` includes an `.rpm`. Host `rpmbuild` comes from Fedora's
  `rpm-build` package (not installed by default). Without it, fpm fails with an
  opaque `rpmbuild failed (exit code )`.
- Linux packages install under `/opt/Omi` (space-free). electron-builder's fpm
  target uses `productName` as the `/opt/` directory; `"Omi for Windows"` broke
  Fedora rpm builds. Windows display names stay `Omi for Windows` via NSIS
  shortcut/uninstall strings.

## Wayland

The app targets X11 by default on Linux (`ozone-platform=x11`, i.e. XWayland on
Wayland hosts) because that path keeps global shortcuts and the X11 active-window
seam working today. On compositors known to have limited XWayland support (niri,
Sway, Hyprland — detected via each compositor's session-marker env var in
`src/main/linuxCompositor.ts`) it instead defaults to native Wayland, since
XWayland there can fail to map the main window at all. Set `OMI_OZONE=x11` or
`OMI_OZONE=wayland` to override the auto-detected choice either way.

**Portal identity (global shortcuts on native Wayland):** Electron binds
`globalShortcut` through `org.freedesktop.portal.GlobalShortcuts` when running
native Wayland. That requires a stable app ID:

- `package.json` → `"desktopName": "com.omiwindows.app"` (matches `appId`)
- Shipped `.desktop` → generated by electron-builder from `linux.desktop.entry`
  (`StartupWMClass=omi-windows`; filename from `package.json` `desktopName` via
  `syncDesktopName`). Reference copy: `resources/linux/com.omiwindows.app.desktop`
- Main process calls `app.setDesktopName('com.omiwindows.app')` before `ready`

Session facts are centralized in `src/main/linux/linuxSession.ts` and logged at
startup as `[linux] session=… ozone=… portal=… shortcuts=…`.

On native Wayland the floating bar uses a **full-width top strip** (pill stays at
the screen top via in-window layout), **hides with `win.hide()`** when dismissed
instead of parking off-screen, skips `setAlwaysOnTop`, and does **not** create the
focus-halo glow window (Win32-only today). Global summon shortcuts remain
unavailable on native Wayland.

Screen capture on Wayland goes through the desktop portal, which asks
"Share screen?" for consent — and Electron has no persisted-consent path, so
*continuous* Rewind capture would re-prompt every frame. Therefore, on a Wayland
session, **continuous Rewind capture defaults OFF** (`XDG_SESSION_TYPE=wayland`);
on-demand "what's on my screen" still works (one Share prompt), and you can enable
continuous capture explicitly. X11 sessions keep continuous Rewind on by default.

**Settings → Shortcuts (phase 1 + 2a):** each global chord has a **Test** button that
probes whether the OS will accept it (`shortcuts:test-accelerator` — suspend live
chords, register a noop probe, resume). On Linux, a read-only **Linux shortcut
environment** row shows portal/ozone/session facts from `linuxSession.ts`. On niri,
packaged builds can **Apply** compositor keybinds (consent → scan includes → write
managed block).

**Onboarding gap (phase 2b — not done):** `ShortcutSetupStep` still assumes in-app
shortcut delivery. It does not run the niri Apply consent flow, so first-run on
niri can stall on “press your shortcut” unless the user Skips. Tracked in
`formed2forge/handoffs` → `omi-linux-shortcuts.md`.

**niri / sway:** these compositors do not deliver in-app global shortcut events to
Electron apps — registration (and the Test button) can succeed while key presses
never reach Omi.

**niri (packaged builds):** Settings → Shortcuts prompts to **Apply** compositor
keybinds. Omi scans `config.kdl` **and included KDL files** for conflicts, then
writes a marked managed block into the **top-level** `binds {}` only (never into
`recent-windows { binds {…} }`, which only allows `next-window` /
`previous-window`). It never overwrites a chord already bound to something else.
Cancel shows the manual config note instead.

```text
omi-windows --omi-action summon
omi-windows --omi-action record-mic
```

Example niri config (manual / Cancel path):

```kdl
binds {
    Mod+Shift+Space { spawn "omi-windows" "--omi-action" "summon"; }
    Mod+Ctrl+Space { spawn "omi-windows" "--omi-action" "record-mic"; }
}
```

Automatic install requires a packaged AppImage/deb/rpm. For AppImage, spawn uses
`$APPIMAGE` (stable path to the `.AppImage` file), not the ephemeral
`/tmp/.mount_*` extract (`process.execPath`). `pnpm dev` keeps the manual note
only.

**KDE / Plasma:** in-app `globalShortcut` is expected to deliver (unlike niri).
Settings → Shortcuts also **scans** `~/.config/kglobalshortcutsrc` (KGlobalAccel)
read-only and warns when summon/record chords collide with a Plasma binding.
Omi does not write Plasma shortcuts in this phase — change the chord in Omi or
in System Settings → Shortcuts.

## What works / what's next
- ✅ Sign-in, mic → cloud transcription, chat, memory (inherited, cross-platform)
- ⚠️ App-usage tracking (X11 active-window via `linuxForeground.ts`;
  `foregroundMonitor` starts on `linux` with 15s poll — WinEvent subscribe stays
  win32-only / no-op on Linux). Covered by parser/unit tests + packaging depends
  (`x11-utils`); not yet runtime-smoked under Xvfb in CI.
- ✅ Screen OCR / "what's on my screen" (Rewind capture → `omi-ocr-helper` → Tesseract;
  Ubuntu CI helper smoke covers OCR protocol)
- ⚠️ Wayland sessions via XWayland (shortcuts intended to work; continuous Rewind
  off by default — see the Wayland section). Active-window on XWayland shares the
  same unit-tested / not-yet-runtime-smoked caveat as X11 above.
- ⏳ Tray / Quit (reuse Windows tray module when it lands — Linux needs
  context-menu-first tray, not double-click).
- ⏳ Auto-update (AppImage-only: gate on `process.env.APPIMAGE`, not just
  `isPackaged`; `.deb` / `.rpm` stay package-manager).
- ⏳ XDG autostart (`.desktop` under `~/.config/autostart`) when launch-at-login
  Settings exists on this tree. Base `.desktop` ships in `resources/linux/` for
  packaging; autostart wiring is still TODO.
- ⏳ Pendant BLE, Glass video, native-Wayland capture (portal restore-token),
  full Windows-parity feature wave (lands with the Windows desktop umbrella,
  then reuses these Linux seams).

## Implementation notes
- `src/main/linux/linuxSession.ts` — portal app ID, session/desktop env detection,
  global-shortcut capability hints (phase 0 of Linux shortcuts work).
- `src/main/usage/nativeForeground.ts` — Linux branch delegates to the above; the
  Windows (koffi) path is unchanged. koffi is lazy-`require`d so Linux import of
  this module (and of `userAssistRegistry.ts`) never loads the Win32 native at
  eval time.
- `src/main/usage/foregroundMonitor.ts` — starts on `win32` **and** `linux`.
  Linux is poll-only; event subscribe is a no-op off-win32.
- `src/main/automation/foregroundTargetLogic.ts` — uses `path.win32.basename` so
  exe-path comparison is correct on both Windows and Linux.
- `resources/linux-ocr-helper/omi-ocr-helper` — a Node-script helper that speaks
  the exact `ocr/helperProtocol.ts` stdio frame protocol as `win-ocr-helper.exe`,
  backed by the `tesseract` CLI for OCR and `xprop`/`/proc` for window info.
  `ocr/helperProcess.ts` spawns it with **Electron's bundled Node**
  (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so it needs no system `node`
  in packaged AppImage/deb/rpm builds.
- `src/main/ocr/resolveHelperPath.ts` — returns the Linux helper path on Linux;
  the Windows path is unchanged. `electron-builder.config.mjs` unpacks `resources/**`,
  so packaged Linux builds ship the helper.
- `electron-builder.config.mjs` — Linux targets are **AppImage + deb + rpm** (snap omitted:
  strict confinement blocks `xprop`/`tesseract`/`/proc`).

### Future enhancement
For one-shot "look at my screen now" questions, a vision model (Claude vision, or
the moondream path used by the Glasses) would understand UI/images better than OCR.
OCR is used here for parity with Omi's continuous, local, searchable Rewind model.
