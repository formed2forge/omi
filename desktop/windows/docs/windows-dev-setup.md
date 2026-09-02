# Fresh Windows → Omi desktop dev and test environment

Step-by-step for a **native Windows** machine. This is the path for actually
testing the Windows/Linux Electron app (`desktop/windows/`) on Windows — OCR,
UI automation, WASAPI mute, Rewind capture, the companion bar, and the
installer. Those native helpers do not run inside WSL.

The public quickstart is still [`../README.md`](../README.md). This file is the
from-zero machine setup that README assumes you already did.

## What this machine can and cannot do

| Surface | On Windows |
|---|---|
| Electron desktop (`desktop/windows/`) | **This is why the machine exists.** Dev, unit tests, E2E, unpack, NSIS installer. |
| Backend Python (`backend/`) | Yes, via Git Bash + Python 3.11. Local emulator harness is extra work (Java + Redis). |
| Flutter Android (`app/`) | Yes, with Android Studio. |
| Web app (`web/app/`) | Yes, with Bun. |
| macOS desktop (`desktop/macos/`) | No. Needs a Mac. |
| iOS | No. Needs Xcode. |
| Firmware / Xcode flashing | No. |

Do **not** develop or launch the Electron app from WSL. WSL can run backend
unit tests the same way Linux does; it cannot exercise Windows OCR, UIA,
WASAPI, or the companion bar.

## 0. Hardware and OS

- **Windows 10 2004+ or Windows 11, x64.** The .NET helpers target
  `net10.0-windows10.0.19041.0` — confirm with `winver` that the build is
  **19041 or newer** (Windows 10 22H2 is 19045; that is fine). Older 1909-and-
  below boxes need an OS update before this toolchain will even install.
- **x64**. CI and the helpers publish `win-x64`. ARM64 (Snapdragon X) may run
  the x64 Electron build under emulation; it is not what CI packages.
- A real **microphone** and speakers. Meeting/system-audio capture uses
  Chromium loopback (`getDisplayMedia`), not Stereo Mix.
- An account that can install software (local admin for long-paths, Defender
  exclusion, and Visual Studio Build Tools).

Skip Insider / Dev Channel unless you are reproducing an OS-specific bug.

Windows 10 vs 11 does **not** change Node, pnpm, MSVC, the .NET 10 SDK, or the
`pnpm install` / `pnpm dev` / test commands. Differences are Settings labels,
whether `winget` is already present, and one cosmetic backdrop (Mica is
Win11-22H2-only; Win10 gets the flat `#0f0f0f` canvas). There is no separate
OS screen-recording consent prompt on either version — onboarding's screen
step is an in-app Rewind opt-in.

## 1. First-boot Windows settings (once, as Administrator)

Open **Windows Terminal** as Administrator and run:

```powershell
# Long paths (git + node_modules + electron-builder will overflow MAX_PATH otherwise)
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
  -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force

# Execution policy so the repo's .ps1 scripts and uv's installer can run
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Optional but worth it: Defender real-time scan on node_modules makes
# electron-rebuild and pnpm install painfully slow.
# Pick the clone path you will use in step 3.
Add-MpPreference -ExclusionPath 'C:\src\omi'
```

Then in **Settings** (labels differ slightly by OS):

1. **Developer Mode** — on.
   - Windows 11: **System → For developers**
   - Windows 10: **Update & Security → For developers**
2. **Microphone** — "Let desktop apps access your microphone" on. You will
   grant Omi itself during onboarding.
   - Windows 11: **Privacy & security → Microphone**
   - Windows 10: **Privacy → Microphone**
3. **Screen capture** — Windows 10 has no "Screenshots and screen recording"
   privacy page (that is Windows 11). Skip this row. Desktop capture has no
   OS consent prompt; Rewind is an in-app toggle during onboarding.
   On Windows 11, **Privacy & security → Screenshots and screen recording**
   should allow desktop apps.
4. **App execution aliases** — turn **off** the Microsoft Store aliases for
   `python.exe` and `python3.exe`. They shadow a real Python 3.11 install and
   break `node-gyp` / the backend venv.
   - Windows 11: **System → Optional features → App execution aliases** (or
     **Apps → Advanced app settings**)
   - Windows 10: **Apps → App execution aliases**

Reboot once after enabling long paths.

## 2. Install the toolchain

`winget` ships with Windows 11. On Windows 10 it is usually missing until you
install **App Installer** from the Microsoft Store, or
[the GitHub `.msixbundle`](https://aka.ms/getwinget). Then `winget --version`
should print something. Windows Terminal is also not preinstalled on Windows
10 — the `Microsoft.WindowsTerminal` line below installs it; an elevated
**Windows PowerShell** window is enough until then.

Run these in an elevated terminal. Close and reopen it after the Visual
Studio and fnm installs so PATH updates.

### 2a. Git, Make, Terminal, gh

```powershell
winget install --id Git.Git -e --source winget
winget install --id GitHub.cli -e --source winget
winget install --id Microsoft.WindowsTerminal -e --source winget
winget install --id Microsoft.PowerShell -e --source winget
# GNU Make — the repo Makefile already points SHELL at Git Bash on Windows_NT
winget install --id ezwinports.make -e --source winget
```

During the Git installer:

- Pick **Git from the command line and also from 3rd-party software**.
- Checkout: **Checkout as-is, commit Unix-style line endings** (`core.autocrlf
  input` / as-is). The Windows app tree forces LF via
  `desktop/windows/.gitattributes`.
- Default terminal: **Windows Terminal** or Git Bash. Either works; Git Bash is
  required for `make setup` / `make preflight` / `make dev-up`.

Then:

```powershell
git config --global core.longpaths true
git config --global core.autocrlf false
```

Do **not** set a repo-local `user.name` / `user.email`.

Confirm Git Bash exists (the Makefile looks it up from `git --exec-path`):

```powershell
& "$(git --exec-path)\..\..\..\bin\bash.exe" --version
make --version   # GNU Make 3.x/4.x
```

If `make` is missing, you can still run the bash scripts directly (step 4).

### 2b. Visual Studio Build Tools (C++ / node-gyp)

`better-sqlite3` rebuilds against Electron during `pnpm install`. That needs
MSVC, the Windows SDK, and Python — not the full Visual Studio IDE.

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget `
  --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

This is several GB. Wait for it to finish before the next `pnpm install`.

### 2c. .NET 10 SDK (OCR / audio / UI-automation helpers)

The three Windows helpers are `net10.0-windows` self-contained single-file
exes (`win-ocr-helper`, `win-audio-helper`, `win-automation-helper`). Without
this SDK, `pnpm install` still succeeds — postinstall is non-fatal — but
**screen OCR, PTT mute-others, and UI automation stay disabled**.

```powershell
winget install --id Microsoft.DotNet.SDK.10 -e --source winget
```

```powershell
dotnet --list-sdks
# expect a 10.x line
```

CI's `setup-dotnet` still asks for `8.0.x`; that is the runner pin, not the
helper TFM. Locally you need the SDK that can publish `net10.0-windows`.

### 2d. Node 22.19+ (not 23, not 24+) and pnpm 10

`package.json` engines: `>=22.19.0 <23`. Node 24+ breaks the jsdom test
suites (`scripts/check-node-version.mjs`). Do not install an unversioned
"Node.js LTS" from winget — it may be 24.

**fnm** reads `.nvmrc` (`22.19.0`) and works in PowerShell and Git Bash:

```powershell
winget install --id Schniz.fnm -e --source winget
```

Restart the terminal, then in PowerShell:

```powershell
# persist for new shells
Add-Content $PROFILE "`nfnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression"
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install 22.19.0
fnm use 22.19.0
fnm default 22.19.0
node -v   # v22.19.0
corepack enable
corepack prepare pnpm@10 --activate
pnpm -v   # 10.x
```

In Git Bash, add to `~/.bashrc`:

```bash
eval "$(fnm env --use-on-cd --shell bash)"
```

`nvm-windows` also works (`nvm install 22.19.0 && nvm use 22.19.0`) but does
not auto-read `.nvmrc` the way Unix nvm does — pin it explicitly.

**pnpm must be major version 10.** CI pins `pnpm/action-setup@v6` to 10. A
system pnpm 11+ silently ignores `.npmrc`'s `node-linker=hoisted` and breaks
the pi-mono unpack check. If `pnpm -v` is not 10.x, use `npx pnpm@10 <cmd>`
instead of downgrading a machine-wide install.

Never run `npm install` in `desktop/windows/` — it corrupts `package.json` /
`pnpm-lock.yaml` / `pnpm-workspace.yaml` and leaves a stray
`package-lock.json`. `git restore` those three files and reinstall with pnpm.

### 2e. Python 3.11 (backend + node-gyp)

The backend pins 3.11 (not 3.12+). node-gyp also wants a real CPython on PATH.

```powershell
winget install --id Python.Python.3.11 -e --source winget
```

Close the terminal, reopen, then:

```powershell
py -3.11 --version   # 3.11.x
python --version     # should also be 3.11.x, not the Store stub
```

If `python` is 3.12+ or missing, `py -3.11` still works. For backend scripts
that look up `python3`, Git Bash often needs:

```powershell
# Git Bash: ln -s "$(py -3.11 -c 'import sys; print(sys.executable)')" /usr/local/bin/python3
# easier: put the 3.11 install dir first on User PATH
```

The Python installer typically lands at
`%LocalAppData%\Programs\Python\Python311\`. Add that directory **and**
`Scripts\` to your User PATH.

Backend lock sync uses **uv**:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv --version
```

**libopus** (only if you run the Python backend, not required for the Electron
app): `opuslib` needs `opus.dll` on PATH. One setup is MSYS2 UCRT64:
install MSYS2, `pacman -S mingw-w64-ucrt-x86_64-opus`, add
`C:\msys64\ucrt64\bin` to PATH, confirm with `where.exe opus.dll`.

### 2f. Optional: Java 21 + Redis (local backend harness only)

Skip this if you are only testing the Electron app against production
(`api.omi.me` — the default `.env.example`). Needed for `make dev-up`.

```powershell
winget install --id Microsoft.OpenJDK.21 -e --source winget
```

Windows has no first-party `redis-server`. Options: run Redis in Docker, WSL,
or [Memurai Developer](https://www.memurai.com/). The harness looks up
`redis-server` on PATH and binds an instance-scoped loopback port (default
6380). `make desktop-run-local` launches the **macOS** named bundle, not
Electron — on Windows, start the harness then point
`VITE_OMI_API_BASE` at `http://127.0.0.1:8000` yourself if you need it.

## 3. Clone the repo

Use a **short path**. `C:\src\omi` beats
`C:\Users\Very Long Name\Documents\GitHub\...`.

```powershell
New-Item -ItemType Directory -Force C:\src | Out-Null
cd C:\src
git clone https://github.com/BasedHardware/omi.git
cd omi
```

If you work from a fork, clone the fork and add upstream:

```powershell
git remote add upstream https://github.com/BasedHardware/omi.git
git fetch upstream
```

Add the Defender exclusion for this path if you did not in step 1.

## 4. Repo-level setup (hooks + backend venv)

From **Git Bash** at the repo root (not PowerShell — `make` recipes are bash):

```bash
# Git Bash
cd /c/src/omi
make setup
```

That fetches `origin/main` when safe, installs the pre-commit / pre-push
dispatchers, and syncs `backend/.venv` from `pylock.toml`.

Without GNU Make:

```bash
bash scripts/setup-refresh-main.sh
bash scripts/install-git-hooks.sh
bash backend/scripts/sync-python-deps.sh
```

Confirm:

```bash
test -x "$(git rev-parse --git-path hooks)/pre-commit" && echo hooks-ok
backend/.venv/Scripts/python.exe -V   # 3.11.x
```

## 5. Windows desktop app — the actual testing environment

```powershell
cd C:\src\omi\desktop\windows
fnm use   # or: fnm use 22.19.0
pnpm -v   # 10.x
Copy-Item .env.example .env
pnpm install --frozen-lockfile
```

`.env.example` already has Omi's **public** Firebase + PostHog config. After
the copy, sign-in works with any Omi Google/Apple account. No extra keys
required for a first launch.

Watch the install log. You want all three helpers built, not the
`[ensure-*-helper] WARNING` banners:

```text
build-ocr-helper: published to ...\resources\win-ocr-helper
build-audio-helper: published to ...\resources\win-audio-helper
build-automation-helper: published to ...\resources\win-automation-helper
```

If a helper warned, install the .NET 10 SDK (step 2c), then:

```powershell
pnpm run build:ocr-helper
pnpm run build:audio-helper
pnpm run build:automation-helper
```

Confirm the binaries exist:

```powershell
Get-ChildItem resources\win-ocr-helper\win-ocr-helper.exe,
             resources\win-audio-helper\win-audio-helper.exe,
             resources\win-automation-helper\win-automation-helper.exe
```

### Launch

```powershell
pnpm dev
```

Primary checkout: renderer `http://localhost:5179`, CDP `9222`. Sign in through
the system browser. Onboarding will ask for microphone, screen capture, and
(optional) UI automation.

**electron-vite does not restart the main process** on `src/main` edits.
Restart `pnpm dev` before judging bar motion, capture, or helper changes.
Read [`bar-gotchas.md`](bar-gotchas.md) before touching the companion bar.

Optional `.env` keys (safe to leave blank):

| Key | Why |
|---|---|
| `VITE_OMI_API_KEY` | Cloud-sync recorded conversations. Settings → Developer in the Omi app. Blank = local only. |
| `MAIN_VITE_GOOGLE_CLIENT_ID` / `MAIN_VITE_GOOGLE_CLIENT_SECRET` / `VITE_ENABLE_GOOGLE_INTEGRATION=1` | Gmail/Calendar integration. Desktop OAuth client in Google Cloud Console. Never commit. |

Default API targets (already in `.env.example`): `VITE_OMI_API_BASE=https://api.omi.me`
and `VITE_OMI_DESKTOP_API_BASE=https://desktop-backend-hhibjajaja-uc.a.run.app`.

### Parallel worktrees

```powershell
# from repo root, Git Bash or PowerShell
git fetch origin
git worktree add .worktrees/<name> -b <branch> origin/main
cd .worktrees\<name>\desktop\windows
pnpm bootstrap
pnpm dev
```

Each linked worktree gets its own renderer port, CDP port, and userData
profile. Details: [`multi-worktree-dev.md`](multi-worktree-dev.md).

## 6. First-run OS permissions (do these in the running app)

Work through onboarding rather than skipping. Windows privacy toggles that
onboarding cannot flip for you:

1. **Microphone** — if the step says "Windows blocked microphone access", open
   Settings → Privacy & security → Microphone, allow desktop apps **and** Omi,
   then return. The step reads the Capability Access Manager registry, not
   Chromium's fake `navigator.permissions.query({name:'microphone'})`.
2. **Screen capture** — accept the Graphics Capture / screen-share prompt.
   Needed for Rewind and meeting loopback. Skipping leaves Rewind off.
3. **UI automation** — onboarding's automation step. Needs
   `win-automation-helper.exe` from step 5. Windows has no separate
   Accessibility grant like macOS.
4. **Notifications** if Windows pops a toast prompt.

Then a 5-minute smoke that CI never runs:

1. Companion bar appears; a **physical** mouse click (not a synthetic one)
   summons / dismisses it. Synthetic clicks lie on this window — see
   [`bar-gotchas.md`](bar-gotchas.md) trap 4.
2. Push-to-talk: hold the PTT shortcut, speak, release; you should get a
   transcript. Other-app mute needs `win-audio-helper.exe`.
3. Ask Omi something that requires looking at the screen — OCR needs
   `win-ocr-helper.exe`.
4. Start a screen/meeting session, speak, play system audio, stop. A local
   conversation should appear. Cloud sync needs `VITE_OMI_API_KEY`
   ([`conversation-sync.md`](conversation-sync.md)).
5. Settings → Agents: Claude Code is built in. Optional: connect OpenClaw /
   Hermes / Codex with a launch command and hit **Test**.

## 7. Daily test commands

From `desktop/windows/`, Node 22.19 + pnpm 10:

```powershell
pnpm typecheck    # tsc node + web (blocking in CI)
pnpm lint         # ESLint blocking; Prettier is not
pnpm test         # vitest ~550 tests against an Electron stub — no GUI needed
```

That is what the ubuntu `checks` job runs. It does **not** prove Windows
runtime behavior.

### GUI / E2E (maintainer toolkit — not in CI)

Package.json scripts under `test:e2e:*`, `smoke:*`, `soak*`, `orb:*`,
`verify:*`. Specs live in `e2e/`. Run the one that matches the surface you
changed; do not assume `pnpm test` covered it.

A useful first pass on a new machine (after `pnpm dev` has produced
`out/main/index.js`, or after `pnpm build`):

```powershell
pnpm test:e2e:cold-start
pnpm test:e2e:lifecycle
pnpm test:e2e:bar
pnpm test:e2e:ptt-gesture
pnpm test:e2e:failure-ux
pnpm test:e2e:db-recovery
```

Live / credentialed (need a signed-in session, mic, or cloud):

```powershell
pnpm test:e2e:ptt
pnpm test:e2e:voice-smoke
pnpm test:e2e:conv-sync
pnpm test:e2e:agent
pnpm test:e2e:meeting-live
```

Packaged binary (this is what `build-windows` CI *builds* but does not
launch):

```powershell
pnpm build:unpack
# run: desktop\windows\dist\win-unpacked\*.exe
pnpm build:win          # NSIS installer, --publish never
```

Every electron-builder invocation must pass `--config electron-builder.config.mjs`
(the npm scripts already do).

### Repo PR gate

From Git Bash at the repo root, after drafting a PR body:

```bash
make preflight
scripts/pr-preflight --suggest
# then: scripts/pr-preflight --pr-body-file /path/to/body.md
```

`fix:` commits need `Failure-Class: FC-<slug> | new | none`.

## 8. Optional: Flutter Android

iOS cannot be built here. Android can.

1. Install [Android Studio](https://developer.android.com/studio) and the
   Flutter SDK **3.44.5** ([install docs](https://docs.flutter.dev/get-started/install/windows)).
2. SDK Manager: Android SDK Platform 35, NDK `28.2.13676358`, JDK 21.
3. `flutter doctor --android-licenses` then `flutter doctor -v`.
4. Local backend (Git Bash): `make dev-init` once, then `make dev-up`
   (or `PROVIDER_MODE=offline make dev-up`).
5. `cd app && bash setup.sh android` then `flutter run --flavor dev`.

The Android emulator reaches the host as `10.0.2.2`. Do not point a `dev`
flavor at `https://api.omiapi.com/` — emulator Firebase tokens are
`demo-omi-local` and production will 401. Full path:
[`docs/doc/developer/AppSetup.mdx`](../../../docs/doc/developer/AppSetup.mdx).

Never run `flutterfire configure` against Omi's bundle IDs.

## 9. Optional: web app

```powershell
# https://bun.sh — Windows installer
cd C:\src\omi\web\app
bun install
bun run dev
bun run check    # typecheck + tests; what CI runs
```

Use Bun, not npm/pnpm. See `web/app/AGENTS.md`.

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `pnpm test` dies in jsdom with `localStorage` / `undefined` | Node 24+. `node -v` must be 22.19–22.x. |
| `closure package(s) do not resolve on disk` during postinstall | pnpm 11+ ignored `node-linker=hoisted`. Use `npx pnpm@10`. |
| Unexplained diffs in `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` | Someone ran `npm install`. `git restore` those files, `Remove-Item -Recurse node_modules`, reinstall with pnpm. |
| `[ensure-ocr-helper] WARNING` (and audio/automation) | No .NET 10 SDK, or `dotnet` not on PATH in that shell. Install SDK, reopen terminal, `pnpm run build:ocr-helper` (etc.). |
| `better-sqlite3` rebuild fails | VS 2022 Build Tools C++ workload missing, or Store Python stub. |
| App starts, tray icon, no window | Rare on Windows (mostly a Linux/Wayland issue). Check the DevTools / main-process console. |
| Mic step auto-advances or shows Granted when Windows blocked it | Old bug; current code reads the registry. Confirm Privacy → Microphone allows desktop apps. |
| Bar does not respond to clicks, but Playwright passes | Physical clicks vs synthetic — [`bar-gotchas.md`](bar-gotchas.md) trap 4. |
| `make setup` / `make preflight` cannot find bash | Git for Windows not installed, or Make is using cmd.exe. Use Git Bash; the Makefile sets `SHELL` from `git --exec-path`. |
| `python` is 3.12+ or a Store alias | Step 1 aliases + step 2e PATH. Backend **must** be 3.11. |
| Clone or `pnpm install` fails with path-too-long | Long paths registry + `core.longpaths` + clone to `C:\src\omi`. |
| `winget` not recognized | Windows 10 without App Installer. Install it from the Store or https://aka.ms/getwinget, then reopen the terminal. |
| Main window looks flat/opaque, no frosted backdrop | Expected on Windows 10. Mica is gated at build 22621 (Win11 22H2); the app uses `#0f0f0f`. |

## 11. What "fully functional" looks like

A Windows test box is done when all of these are true:

- `node -v` is 22.19.x, `pnpm -v` is 10.x, `dotnet --list-sdks` includes 10.x.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass in `desktop/windows`.
- The three `resources/win-*-helper/win-*-helper.exe` binaries exist.
- `pnpm dev` signs in, onboarding grants mic + screen capture, the bar
  responds to a physical click, PTT transcribes, and screen OCR returns text.
- `pnpm build:unpack` produces a launchable `dist/win-unpacked` exe.

That last GUI pass is the gap CI does not cover today (`build-windows` packages
only). Treat it as part of the machine's job, not optional polish.
