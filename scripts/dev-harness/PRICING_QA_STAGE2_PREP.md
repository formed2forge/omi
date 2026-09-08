# Pricing QA — Stage-2 GUI matrix preparation (Worker C, run 3)

Preparation-only pass. **No GUI was driven, no harness process was started, no
app/simulator/bundle account was signed in or switched** by this doc's author.
Findings below are either directly observed (commands run, files read) or
explicitly marked as carried over from a prior evidence file.

Verified worktree state: `/Volumes/LEXAR/tempdev/omi-worktrees/wc-qa-prep` @
`784bc4542e23fc59e197135f4c96b5820eb165dd` (`run3/wc-qa-prep`), confirmed via
`git rev-parse HEAD`. This is the designated verification SHA per
`PRICING_QA_PASS_2026-09.md` §"Designating verification SHA" /
handoffs `omi-pricing.md` §126.

Sole writer of this file. Do not add unrelated content here — extend the
existing `PRICING_IOS.md` / `PRICING_MACOS.md` / `PRICING_WINDOWS.md` /
`PRICING_SCENARIOS.md` docs directly for their own scope; this file is a
run-3 prep index plus the durable-evidence contract.

---

## 1. Device / emulator / bundle inventory (observed, not launched)

### iOS Simulators — usable, none currently booted

`xcrun simctl list devices available` (run this session):

- iOS 27.0 runtime has an **iPhone 17 Pro** simulator,
  UDID `0DA7CD04-CDFE-4E5E-9E0D-F657F568BB7B` — this is the **exact device**
  `PRICING_QA_AGENT2_EVIDENCE.md` used for the live post-fix iOS pass. Present,
  installed, state `Shutdown` (not booted by this prep pass).
- iOS 26.5 runtime also has a full device set (iPhone 17 Pro
  `C615171C-8D64-4CF7-AA43-6D732B232111`, etc.) — this is what the *earlier*
  15-scenario baseline pass (`omi-attachments/pricing-ios-qa-2026-09-07`) used.
- 11 iPhone/iPad models × 2 iOS runtimes + 5 watchOS pairs, all `Shutdown`.
  Xcode: **26.6** (build 17F113), via `xcodebuild -version`.

No pin file for a required Xcode version was found in this repo
(`desktop/macos/AGENTS.md` names no version, no `.xcode-version` file exists).
Xcode 26.6 built the app successfully in the prior evidence pass on this same
machine, so treat it as the working version, not a verified pin.

### Android emulators — **BLOCKED: no AVD exists, no SDK on PATH**

Directly observed, this session:

```
$ which emulator      → not found
$ echo $ANDROID_HOME  → empty
$ echo $ANDROID_SDK_ROOT → empty
$ ls ~/.android/avd   → No such file or directory
$ avdmanager list avd → command not found
```

**The user's instruction that Android-emulator verification is sufficient
cannot be honored on this machine today** — there is no Android SDK installed
at all (no `ANDROID_HOME`, no `emulator` binary, no `avdmanager`, no
`~/.android/avd` directory), so there is no AVD to confirm working or
broken. `app/e2e/SKILL.md` names an expected AVD `omi-dev` (x86_64/arm64
unspecified in that doc) — that AVD does not exist on this Mac.
**Exactly what's missing to unblock**: install Android Studio or the
command-line SDK tools, set `ANDROID_HOME`/`ANDROID_SDK_ROOT`, install an
x86_64 or arm64 system image via `sdkmanager`, then
`avdmanager create avd -n omi-dev ...`. None of this was done here — it's a
real environment gap, not a config toggle.

### macOS named development bundle — confirmed distinct from production

From `desktop/macos/AGENTS.md`:

- **Build command**: `xcrun swift build -c debug --package-path Desktop`
  (line 257).
- **Named-bundle pattern** (lines 274, 281–283): `./run.sh` alone builds
  **"Omi Dev"** → `/Applications/Omi Dev.app`, bundle id `com.omi.desktop-dev`.
  A named test bundle: `OMI_APP_NAME="omi-pricing" ./run.sh` →
  `/Applications/omi-pricing.app`, bundle id `com.omi.omi-pricing`.
- **Production bundles** (line 275): `com.omi.computer-macos` ("Omi") and
  `com.omi.computer-macos.beta` ("Omi Beta") — built by Codemagic CI only,
  never by `./run.sh`.
- **Confirmed distinct, no collision path**: `com.omi.omi-pricing` /
  `com.omi.desktop-dev` share no bundle-id or install-path segment with
  `com.omi.computer-macos` / `com.omi.computer-macos.beta`. `./run.sh` with an
  explicit `OMI_APP_NAME` cannot overwrite or touch the production bundles —
  they are installed by a separate CI pipeline, not this script, and the
  install paths (`/Applications/omi-pricing.app` vs `/Applications/Omi.app`
  vs `/Applications/Omi Beta.app`) are different files.
- Directly observed in `/Applications` this session (listing only, no launch):
  `Omi Beta.app`, and several pre-existing named pricing-QA bundles from prior
  sessions (`omi-pricing.app`, `omi-dev-pricing-test.app`,
  `omi-pricing-operator.app`, etc.) — evidence the named-bundle pattern has
  already been exercised repeatedly and safely alongside production installs.
- **Per the supervisor's live check this session: production `/Applications/Omi.app`
  is currently running (PIDs 9733/9833).** This prep pass did not touch it,
  did not enumerate its process tree beyond what the supervisor already
  reported, and Stage 2 must launch only `omi-*`-named or `Omi Dev` bundles,
  never `Omi.app`/`Omi Beta.app`.

### Electron-on-Mac (Windows client running on macOS) — deps installable, verified this session

**This is Electron on macOS arm64, NOT native Windows evidence** — no
Windows-only OCR/audio/automation `.NET` helpers exist on this platform;
packaging/installer behavior is entirely unverified by anything in this repo
right now.

- Exact commands (`desktop/windows/AGENTS.md`): `pnpm install --frozen-lockfile`,
  `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build:win`/`:mac`/`:linux`.
- **Pinned pnpm major: 10** (CI: `pnpm/action-setup@v6` pinned to major 10,
  per `desktop/windows/AGENTS.md`). Locally installed: `pnpm 10.34.5` —
  matches the pinned major.
- **Ran `pnpm install --frozen-lockfile` in this worktree this session** (real
  execution, not inferred): succeeded in 13.1s. `WARN Unsupported engine:
  wanted node ">=22.19.0 <23", current v26.7.0` (system default node) — a
  warning, not a failure; install completed, native `better-sqlite3` rebuild
  succeeded, Windows-only OCR/audio/automation helper scripts each correctly
  no-op'd ("not Windows — skipping"), `verify-pimono-unpack` OK. `node@22`
  (22.23.2, via `brew`) is present on this Mac for a version-correct run, same
  as `PRICING_QA_AGENT3_EVIDENCE.md`'s prior session used.
- **Deps are installable.** No blocker found.

### Toolchain versions actually observed this session

| Tool | Observed | Pinned/expected | Match? |
|---|---|---|---|
| Flutter (`which flutter` → `/opt/homebrew/bin/flutter`) | **3.47.2** | **3.44.5** (`.github/workflows/mobile-app-checks.yml:57,119,258`, `repo-checks.yml:236`) | **NO — confirmed drift**, same finding as handoffs §121. Format/analyze/l10n-gen checks need the real 3.44.5 (Worker A cloned it standalone to `/tmp`); `flutter run` for live GUI has worked fine on the drifted 3.47.2 in every prior pass (Agent 2's evidence file used system Flutter, not the pin). Stage 2 should use the pinned 3.44.5 if it needs to match any generation/analysis step, and may reasonably use system Flutter for pure `flutter run` GUI driving as prior passes did — but say explicitly which one was used. |
| Xcode | **26.6** (17F113) | not pinned in-repo | n/a — working version per prior evidence |
| Node (system default) | **v26.7.0** | `desktop/windows/.nvmrc` = `22.19.0` | NO (system default) — but `node@22` (22.23.2) is installed via brew and was proven sufficient in the prior Electron pass; `pnpm install` also succeeds even under v26 (warning only) |
| pnpm | **10.34.5** | major `10` (CI pin) | YES |

---

## 2. Fixture / scenario coverage audit

Source of truth: `scripts/dev-harness/dev_harness/pricing_scenarios.py` (read
in full this session) and `python3 scripts/dev-harness/list-pricing-scenarios.py`
(run this session, output below is real, not transcribed from a doc).

### All 15 scenario/UID rows that exist today

| Scenario | UID | Wire `plan` | Expected display |
|---|---|---|---|
| `plan_catalog_matrix` | `pricing_never_subscribed` | `None` | Free |
| `plan_catalog_matrix` | `pricing_basic` | `basic` | Free |
| `plan_catalog_matrix` | `pricing_plus` | `plus` | Plus |
| `plan_catalog_matrix` | `pricing_pro_v2` | `pro_v2` | Pro |
| `plan_catalog_matrix` | `pricing_unlimited` | `unlimited` | Neo |
| `plan_catalog_matrix` | `pricing_architect` | `architect` | Architect |
| `plan_catalog_matrix` | `pricing_operator` | `operator` | Operator |
| `plan_catalog_matrix` | `pricing_unlimited_v2` | `unlimited_v2` | Unlimited |
| `legacy_and_unknown_plan_resilience` | `pricing_pro` | `pro` (aliased) | Architect |
| `legacy_and_unknown_plan_resilience` | `pricing_unlimited_grandfathered` | `unlimited` | Neo |
| `legacy_and_unknown_plan_resilience` | `pricing_unlimited_post_cutoff` | `unlimited` | Neo |
| `legacy_and_unknown_plan_resilience` | `pricing_unknown_future_plan` | `future_plan_123` | unknown (error state) |
| `cancellation_and_downgrade_safety` | `pricing_plus_cancel_at_period_end` | `plus` | Plus, `cancellation_scheduled` |
| `cancellation_and_downgrade_safety` | `pricing_pro_v2_cancel_at_period_end` | `pro_v2` | Pro, `cancellation_scheduled` |
| `cancellation_and_downgrade_safety` | `pricing_plus_lapsed` | `plus`→lapsed | Free, `access_ended` |

This is exactly the 15 the task brief expects. The fixture format
(`PricingUserSpec` + `_build_scenario`) is a small, bounded dataclass list —
adding a row is a safe, mechanical change (append one `PricingUserSpec`,
re-run `validate_all_scenarios()`).

### Gap list against the newer required states

| Required state | Fixture status | Detail |
|---|---|---|
| Active paid (Plus/Pro/legacy) | **Covered** | `pricing_plus`, `pricing_pro_v2`, `pricing_unlimited`, `pricing_architect`, `pricing_operator`, `pricing_unlimited_v2` |
| Never-subscribed Free | **Covered** | `pricing_never_subscribed` |
| Scheduled cancellation / access-end (entitled, ending) | **Covered** | `pricing_plus_cancel_at_period_end`, `pricing_pro_v2_cancel_at_period_end` — backend now derives `SubscriptionLapse(state=cancellation_scheduled, reason=user_requested, recovery_action=keep_subscription, effective_at=<period_end>)` (`backend/utils/subscription.py:1633-1634`) |
| Lapse cause: cancellation | **Covered** | via `cancellation_scheduled`/`user_requested` above |
| Lapse cause: expiration | **NOT FIXTURABLE — by design, not a missing fixture** | see below |
| Lapse cause: payment failure | **NOT FIXTURABLE — by design, not a missing fixture** | see below |
| Lapse cause: unknown reason | **Covered** | `pricing_plus_lapsed` → `access_ended`/`unknown` (`backend/utils/subscription.py:1646-1647`) |
| Recovery actions | **Covered, already exercised by existing fixtures** | `keep_subscription` (revert cancellation) is the recovery action on both `*_cancel_at_period_end` fixtures; `resubscribe` is the recovery action on `pricing_plus_lapsed`. No new fixture needed — this is a UI action performed against fixtures that already exist. |
| Unknown-plan error state | **Covered** | `pricing_unknown_future_plan` |
| Plus/Pro/legacy identity | **Covered** | see matrix above |
| Unlimited-v2 vs Neo distinction | **Covered** | `pricing_unlimited_v2` vs `pricing_unlimited`/`pricing_unlimited_grandfathered`/`pricing_unlimited_post_cutoff` — this is the exact pair the macOS `catalogGroupingKey` defect (§ macOS Unlimited-v2-vs-Neo fix, `PRICING_QA_AGENT3_EVIDENCE.md`) was about; already fixture-distinct today |
| Account switching | **Covered structurally, no new fixture needed** | Every scenario seeds multiple UIDs into the same emulator session simultaneously; switching accounts is sign-out/sign-in between any two already-seeded UIDs, not a fixture property |

**Why expiration and payment-failure lapse causes cannot be fixtured, and this
is not a gap to fix in the harness:** read
`backend/models/users.py:149-172` directly. `SubscriptionLapseReason` has
exactly two members, `user_requested` and `unknown`, and the class docstring
(lines 160-169) explains why on purpose:
`routers.payment._build_subscription_from_stripe_object` collapses every
terminal Stripe status (`canceled` / `unpaid` / `past_due` /
`incomplete_expired`) and `cancellation_details.reason` into an
indistinguishable Free row **before it ever reaches storage** — the specific
cause survives only as an aggregate, uid-less Prometheus label, never on the
user's own record. Worker B's reviewed design decision (handoffs §122, "don't
invent a reason the data can't back") deliberately did not add
`payment_failed`/`expired` enum members to guess with. A pricing fixture
seeds a Firestore document directly; it cannot fabricate a distinction the
production write path itself doesn't persist. **If per-cause lapse
messaging is ever wanted, the prerequisite is a backend change (start
capturing Stripe's cancellation reason at write time) — Worker B explicitly
deferred this as "prospective-only benefit, its own reviewed PR if ever
wanted." Until then, "expiration" and "payment failure" as distinct QA rows
do not exist and cannot be added as a bounded, safe fixture change; they
require a product/eng decision outside this harness's scope.**

No fixture was written or modified by this prep pass — the two gap rows above
are not bounded/safe changes (they need a real backend capability that
doesn't exist yet, not a data-only fixture add), so nothing was fabricated.

---

## 3. Durable evidence storage

### Existing convention — confirmed, followed (not reinvented)

`/Volumes/LEXAR/tempdev/handoffs` is itself a separate git repository
(`omi-attachments/` under it, tracked, `origin/main` up to date). Prior
pricing QA passes used:

```
omi-attachments/<topic>-qa-<YYYY-MM-DD>/
  TRACKER.md
  screenshots/<platform-prefix>-<uid>-<screen-label>.png
```

Confirmed via `git log --oneline -- omi-attachments/pricing-ios-qa-2026-09-07
omi-attachments/pricing-macos-qa-2026-09-07`: 3 real commits
(`e65836b` iOS 15-row matrix, `ea40475` macOS 15-row matrix, `580c0ba`
Defects 1-3 fix verification) — this is a genuinely git-committed, durable
location, not a scratchpad.

**Prior "missing" iOS screenshots — found, not lost.** The task brief and
`PRICING_QA_PASS_2026-09.md` describe `/tmp/pricing-qa-ios-sept2026/screenshots`
as gone at audit time. A bounded search (a few minutes, this session) of
`omi-attachments/` found:

- `omi-attachments/pricing-ios-qa-2026-09-07/screenshots/` — **19 PNG files**,
  git-committed, e.g. `ios-pricing_plus-settings-drawer-v2.png`,
  `ios-pricing_unknown_future_plan-plan-usage.png`.
- `omi-attachments/pricing-macos-qa-2026-09-07/screenshots/` — **16 PNG files**,
  same pattern.

**Caveat, stated plainly**: these are from the *earlier* full 15-scenario
baseline pass (commit `776c4f2024`, iOS Simulator iOS 26.5), predating the
Defect 1/2 fixes and the whole lapse-notice wave. They are the right
historical record for that pass, but they are **not** evidence for the
current HEAD (`784bc4542e`) and must not be cited as if they were. The
specific screenshots `PRICING_QA_AGENT2_EVIDENCE.md` and
`PRICING_QA_AGENT3_EVIDENCE.md` reference by number (e.g.
`31-after-retry-refetch.png`) were **not** found under `omi-attachments/` —
they were never committed anywhere durable and most likely really are gone
from `/tmp`. Per instructions, not chasing that dead lead further; Stage 2
will simply recapture them fresh against `784bc4542e`.

### Naming scheme for Stage 2 and onward (write this down so it can't drift)

**Directory** (one per QA pass, matches the existing convention exactly):

```
omi-attachments/pricing-qa-<YYYY-MM-DD>/
  TRACKER.md
  screenshots/
```

**Filename**, extending the existing pattern to encode all five required
fields — commit SHA, platform, scenario, UID, outcome:

```
<platform>_<scenario>_<uid>_<outcome>_<sha7>.png
```

- `platform` ∈ `ios | android | macos | windows-electron` (always
  `windows-electron` for Electron-on-Mac runs — never bare `windows` unless
  it is genuinely native Windows)
- `scenario` = the scenario id exactly as in `pricing_scenarios.py`
  (`plan_catalog_matrix`, `legacy_and_unknown_plan_resilience`,
  `cancellation_and_downgrade_safety`)
- `uid` = the exact fixture uid (e.g. `pricing_plus_cancel_at_period_end`)
- `outcome` ∈ `PASS | FAIL | BLOCKED`
- `sha7` = 7-char short SHA of the commit under test (`784bc45` for this
  designated verification SHA)

Example: `ios_cancellation_and_downgrade_safety_pricing_plus_lapsed_PASS_784bc45.png`

Every `TRACKER.md` for a pass must state the full 40-char SHA once at the top
(as `PRICING_QA_PASS_2026-09.md` already does under "Repository commit"), so
the 7-char filename fragment is always traceable to an exact commit. Screens
that need more than one shot per UID (e.g. Settings badge + Plan & Usage +
Manage sheet) get an extra trailing segment, e.g.
`..._PASS_784bc45_manage-sheet.png` — keep the 5 required fields first and
append free text only after all five.

This scheme is now the documented contract for any later worker capturing
Stage-2 evidence: **do not invent a different filename shape**; extend this
file's convention instead of starting a new one.

---

## 4. Windows handoff FACTS — `PRICING_WINDOWS.md` audit against current code

Per the supervisor's correction: `scripts/dev-harness/PRICING_WINDOWS.md`
**already exists** and was read and verified line-by-line against current
code this session, not rewritten. Same treatment given to
`PRICING_SCENARIOS.md`. Verdict below is a correction/extension list, not a
new document.

### Claims verified TRUE against current code (all checked directly this session, not assumed)

| Claim in `PRICING_WINDOWS.md` | Verification |
|---|---|
| Backend API on port 8000, Firebase Auth emulator on port 9099 | `scripts/dev-harness/dev_harness/config.py:15-16`: `AUTH_PORT = 9099`, `BACKEND_PORT = 8000` — exact match |
| `/v1/auth/local-dev/custom-token` endpoint exists | `backend/routers/auth.py:1266`: `@router.post("/local-dev/custom-token")` — exists |
| `OMI_E2E_FAKE_AUTH=1` is a separate, unrelated seam | referenced in `desktop/windows/src/renderer/src/App.tsx`, `hooks/useAuth.ts`, `lib/dev/e2eAuth.ts`, `shared/types.ts`, `preload/index.ts` — real and distinct from the local-dev custom-token path |
| CSP widening keyed off the 3 `.env` values, needs full restart | `desktop/windows/electron.vite.config.ts` and `desktop/windows/src/shared/localDevCsp.ts` both exist and are the files named |
| Node 22 / pnpm 10 | `.nvmrc` = `22.19.0`; CI pins pnpm major 10 — both confirmed in `desktop/windows/AGENTS.md` and `.nvmrc` |
| Scenario/UID matrix (9-row main table) | Matches `pricing_scenarios.py`'s current fixture set and display names exactly — cross-checked row by row this session |

### Native-Windows-harness-support claim: **VERIFIED, and it does NOT claim what might be assumed**

The document **never claims the dev harness runs natively on Windows.** Its
own Step 1 explicitly says "Run this on the Mac hosting the emulators" and
has the Windows machine only edit its `.env` to point `VITE_OMI_API_BASE` /
`VITE_FIREBASE_AUTH_EMULATOR_HOST` at the Mac's LAN/Tailscale address. This
matches what the harness code actually supports — checked directly this
session:

- Every dev-harness entry point (`dev-up.sh`, `dev-down.sh`, `dev-status.sh`,
  `desktop-run-local.sh`, all 12 top-level `.sh` files in
  `scripts/dev-harness/`) has `#!/usr/bin/env bash` and immediately
  `source`s two other bash helper scripts and uses POSIX path joins
  (`"$(dirname "$0")/../.."`). **No `.ps1`, `.bat`, or `.cmd` equivalent
  exists anywhere under `scripts/dev-harness/`** (confirmed via `find`).
  Bash is not a native Windows shell — a Windows machine without WSL or Git
  Bash cannot run these scripts directly.
- **Conclusion, stated as the doc itself states it**: the harness runs on a
  POSIX host only (this Mac, in practice); Windows is a **remote client
  only**, connecting over the network to a Mac-hosted harness. This is
  **VERIFIED against the code**, not an untested assumption — and the
  existing doc already gets this right. No correction needed here.

### Real staleness found in `PRICING_WINDOWS.md` (and identically in `PRICING_MACOS.md`, `PRICING_IOS.md`, `PRICING_SCENARIOS.md`, `PRICING_TEST_TRACKER.md`)

**None of the five platform/scenario docs mention the lapse-notice feature**
that landed in the wave-2 work merged into current HEAD `784bc4542e`
(`feat/authoritative-lapse-state` → `feat/cancellation-placement` →
`feat/lapse-notice-{macos,windows,web}`, handoffs §120-126). Verified present
in this exact worktree this session:

- `backend/models/users.py:145-172` — `SubscriptionLapseState` /
  `SubscriptionLapseReason` / `SubscriptionLapseRecovery` / `SubscriptionLapse`
- Windows: `desktop/windows/src/renderer/src/lib/billing.ts:331` —
  `export function lapseNoticeCopy(lapse: SubscriptionLapse): LapseNoticeCopy`,
  consumed at `PlanUsageTab.tsx:241-261`; test file
  `PlanUsageTab.lapseNotice.test.tsx` exists.
- Flutter: `app/lib/pages/settings/widgets/subscription_lapse_notice_card.dart`
- Web: `web/app/src/components/settings/__tests__/SubscriptionLapseNotice.test.tsx`
- macOS: covered per `PRICING_QA_PASS_2026-09.md`'s own (already-committed)
  "cancellation-placement complete across all four platforms" table —
  `feat/lapse-notice-macos` @ `26895321da`, 5 files under `desktop/macos/`.

None of the platform recipe docs' scenario tables show the new `cancellation_scheduled`
/`access_ended` notice card, its neutral-copy requirement (must not say
"cancel"/"payment failed"/"expired" for the `unknown`-reason case), or the
`keep_subscription`/`resubscribe` recovery actions a Stage-2 tester should
click and verify. **This is the one concrete correction Stage 2 needs**:
whoever runs the live GUI pass must additionally verify, for
`pricing_plus_cancel_at_period_end` / `pricing_pro_v2_cancel_at_period_end`
/ `pricing_plus_lapsed`, that the lapse notice renders with the correct
copy and recovery button — this is new, required-for-sign-off behavior
(handoffs §120) that predates none of the existing platform docs' scenario
tables. Not fixed in this pass (out of scope — "facts only, do NOT write the
Windows supervising-agent prompt," and the sibling docs belong to their own
single-writer convention); flagging precisely instead.

### Environment variables (names only, no values/secrets)

From `PRICING_WINDOWS.md` + this session's direct reads of
`desktop/windows/.env.example` references and `dev_harness/config.py`:

- `VITE_OMI_APP_PROFILE` (must be `local_dev` to show the Developer sign-in)
- `VITE_OMI_API_BASE`
- `VITE_FIREBASE_AUTH_EMULATOR_HOST`
- `VITE_FIREBASE_AUTH_EMULATOR_PORT`
- `OMI_DEV_HOST` (Mac-side, sets the harness bind host before `make dev-up`)
- `OMI_E2E_FAKE_AUTH` (unrelated hermetic seam, not for this flow)

Ports: backend `8000`, Firebase Auth emulator `9099` (both must be reachable
from the Windows/Electron host through the Mac firewall when not on the same
loopback).

---

## 5. What would BLOCK the Stage-2 GUI matrix

Named precisely, in priority order:

1. **Android emulator: hard blocker.** No Android SDK, no `ANDROID_HOME`, no
   AVD exists on this Mac at all. The user's acceptance of Android-emulator
   testing as sufficient cannot be exercised until an AVD is actually
   created — see §1 above for the exact missing steps. This is the single
   biggest gap for Stage 2 if Android coverage is required before sign-off.
2. **Native Windows: not a blocker for *this* phase** (explicitly deferred
   per handoffs §120, "native Windows deferred to a separate later phase, not
   this session's job") — but flagging that when that phase starts, there is
   currently no native Windows machine available anywhere in this session's
   evidence trail; Electron-on-Mac is the only thing that has ever been
   exercised.
3. **Lapse-cause fixture gap (expiration/payment-failure) is permanent, not
   a Stage-2 blocker** — it cannot be closed by seeding more fixtures; it
   needs a backend design change Worker B explicitly deferred. Stage 2 should
   not spend time trying to fixture this; test the two causes that are
   real (`user_requested`, `unknown`) and move on.
4. **Flutter toolchain drift (3.47.2 vs pinned 3.44.5)** is not a hard
   blocker (prior GUI passes ran fine on the drifted version) but Stage 2
   should state explicitly which Flutter binary it used, since format/l10n
   generation checks require the real 3.44.5.
5. **No blocker found for macOS or Electron-on-Mac dep installation** —
   both proven installable/buildable this session and in prior evidence.
6. **Production app is live during this window** (`/Applications/Omi.app`,
   PIDs confirmed running by the supervisor) — not a blocker for Stage 2 as
   long as it only launches `omi-*`/`Omi Dev` named bundles, per §1's bundle-id
   confirmation above.
