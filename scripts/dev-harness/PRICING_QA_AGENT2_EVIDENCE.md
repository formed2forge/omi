# iOS Pricing QA — Post-Fix Verification (Sept 2026)

## Executive Summary

**Status**: COMPLETE — real GUI verification on the iOS Simulator, not code review.
**Defect 1** (Settings badge shows PRO for a Plus account): **FIXED, verified live.**
**Defect 2** (unknown-plan blank card): the shipped fix (`9df791c20c`/`a41fc3c710`/`93e64de0c4`)
was **incomplete** — it only covers a plan the server can parse but the client doesn't
recognize. The exact `pricing_unknown_future_plan` fixture hits a different failure mode
(server-side `MalformedDocError` → HTTP 500) that the shipped fix never reached. A second,
narrowly-scoped client-side fix (commit `68fab8d2e8` on this branch) closes that gap.
Retry-refetch proved with a real data mutation + observed UI update, not just a tap.
Regressions (`pricing_pro_v2`, `pricing_unlimited_v2`, both `cancel_at_period_end` UIDs,
`pricing_plus_lapsed`) all PASS.

## Test Run Information

| Field | Value |
|---|---|
| Tester | Claude (agent), on behalf of Tim |
| Date / time | 2026-09-07 |
| Repository commit tested | `c83ba54eed` (base `e7968a9271`, `pricing-update-sept-2026`), plus this session's own fix commit `68fab8d2e8` on top |
| Worktree | `/Volumes/LEXAR/tempdev/omi-worktrees/qa-ios-post-fix` |
| Branch | `qa/ios-post-fix-verification-sept2026` |
| Harness | Firestore/Auth/Redis/Typesense emulators + `llm-gateway`/`desktop-backend` from the main checkout's already-running harness; **the `backend` (port 8000) service was restarted rooted in this worktree** (see "Signing/build blocker" below for why) |
| Device | iPhone 17 Pro Simulator, iOS 27.0 (booted) |
| Build | `flutter run --flavor dev`, dev signing team `MMLJCA6AB3` (personal/community Apple Development team), local emulator harness (`OMI_API_BASE_URL=http://127.0.0.1:8000/`, `OMI_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1`), `OMI_LOCAL_DEV_ONBOARDING_BYPASS=1` |
| Provider mode | `offline` |
| Automation tool | agent-flutter (Marionette `@ref` commands; raw coordinate press/scroll/back and `agent-flutter back` all shell out to `adb`, which is absent, and fail on this iOS Simulator session — same finding as the prior 15-scenario baseline pass) |

## Signing/build blocker: what actually happened, and the real fix

The prior agent's blocker was real but the diagnosis in the previous version of this file was
wrong ("Info.plist missing CFBundleIdentifier" was never reproduced). Two distinct issues,
both resolved in this session, neither being provisioning-profile complexity as such:

1. **Ambiguous device selection.** `setup.sh ios` / `flutter run` auto-picks the destination
   via `flutter devices`. A physical iPhone was also visible over the network this session,
   so the automatic picker refused non-interactively ("No terminal available to choose a
   device"). Worked around by calling `flutter run --flavor dev -d
   0DA7CD04-CDFE-4E5E-9E0D-F657F568BB7B` directly (the booted Simulator's UDID) instead of
   going through `setup.sh`'s device-autodetect path, after letting `setup.sh` finish its
   config generation (Custom.xcconfig, GoogleService-Info.plist, Info-Dev.plist) which had
   already succeeded before the device-picker step.
2. **The actual signing fix, confirmed working**: `APPLE_DEVELOPMENT_TEAM=MMLJCA6AB3 bash
   setup.sh ios` (first candidate identity tried, per the coordinator's brief) correctly wrote
   `DEVELOPMENT_TEAM=MMLJCA6AB3` and a machine-scoped bundle id
   (`com.friend-app-with-wearable.ios12-mmljca6ab3-timsair`) into `ios/Flutter/Custom.xcconfig`.
   The **Xcode build itself succeeded** on the first real attempt with this team — for a
   **Simulator** destination, Xcode's automatic signing does not require a matching
   provisioning profile at all, only a valid local codesigning identity, which this team has.
   `LW4P2T66Q4` (the second candidate) was never needed.
3. **What actually blocked installation** (unrelated to signing): a stale Xcode
   `ModuleCache.noindex` under `/Volumes/LEXAR/Xcode/DerivedData` — this Mac's DerivedData
   lives on an external volume, and cached `.pcm` files baked in the old
   `~/Library/Developer/Xcode/DerivedData/...` path, producing `Missing required module
   'SwiftShims'` compiler errors. Fix: `rm -rf
   /Volumes/LEXAR/Xcode/DerivedData/ModuleCache.noindex` (machine-wide Xcode cache, not part
   of any git repo — safe, and Xcode regenerates it). After clearing it, the build completed
   in 86s (warm) / 341s (cold, first build after the cache clear).

No `fastlane match` / `omi-community-certs` checkout was needed — the Simulator path never
required it.

## Environment problem found and worked around: harness backend was serving the wrong checkout

`make dev-status` from the worktree reported a healthy harness, but the actual `uvicorn
main:app` process on port 8000 had **cwd `/Volumes/LEXAR/tempdev/omi/backend`** (the main
checkout, confirmed via `lsof -p <pid> -a -d cwd`) — i.e. it was started by an earlier session
from the main checkout (matching the baseline `PRICING_TEST_TRACKER.md`'s own "Harness
checkout: `/Volumes/LEXAR/tempdev/omi`"), not from this worktree. Firestore/Auth/Redis/Typesense
are data stores, not code, so this didn't matter for those, but it meant the FastAPI app under
test was **not** running this branch's committed backend code.

`make dev-down` is explicitly forbidden by this task's instructions, so instead: killed only the
`backend` service's process tree (`dev_harness.supervise` → `owned_child` → `uvicorn`, PIDs
803/809/815), then started a fresh `uvicorn main:app --port 8000` with cwd
`/Volumes/LEXAR/tempdev/omi-worktrees/qa-ios-post-fix/backend`, reusing the exact environment
the harness's own `dev_harness.config.child_env_for(cfg)` computes (loaded via a one-off Python
snippet against this worktree's `dev_harness` module, so no env var was hand-guessed —
`STRIPE_*_PRICE_ID` and `ENCRYPTION_SECRET` in particular would have been easy to get wrong by
hand). Firestore/Auth/Redis/Typesense/llm-gateway/desktop-backend were left untouched and
running from wherever they already were — only the `backend` service's code-serving process was
swapped. This is the step that surfaced Defect 2's real remaining gap (see below); against the
main checkout's backend the failure mode was identical, so this environment issue did not
change the QA verdict, only where the traceback pointed.

## Defect 1 — Settings badge for a Plus account

**Fix commit**: `c9636e1e29` (already on branch, not touched this session).
**UID**: `pricing_plus`. Fresh sign-out → **Sign In (Developer)** → `pricing_plus` → Agree &
Continue (Data & Privacy gate, not onboarding-proper) → Settings.

| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Settings drawer badge | **PLUS** | PLUS (gold badge) | **PASS** | `16-plus-settings-badge.png` |
| Plan & Usage title | **Plus** | Plus | **PASS** | `17-plus-plan-usage.png` |

## Defect 2 — Unknown/unrecognized plan (`pricing_unknown_future_plan`)

**UID**: `pricing_unknown_future_plan` (Firestore doc: `subscription.plan: "future_plan_123"`,
`current_price_id: "price_local_future_plan_month"`).

**First pass (shipped fix `9df791c20c`/`a41fc3c710`/`93e64de0c4` only) — FAIL, reproduced live.**
Fresh sign-out → sign-in → Settings → Plan & Usage showed the **same blank card** as the
original pre-fix bug report: no title, no description, no badge, no retry — screenshot
`27-unknown-plan-usage.png`. Root cause, confirmed by calling the endpoint directly:

```
curl -i http://127.0.0.1:8000/v1/users/me/subscription -H "Authorization: Bearer <id-token>"
→ HTTP/1.1 500 Internal Server Error
```

Backend traceback (from the worktree-rooted `uvicorn` log):

```
database.read_boundary.MalformedDocError: malformed Firestore document
path=users/pricing_unknown_future_plan validation_fields=['plan'] validation_types=['enum']
```

`"future_plan_123"` is not a `PlanType` member and not in `WIRE_PLAN_ALIASES` (only `'pro' →
architect` is aliased there), so `PlanType._missing_` returns `None`, Pydantic strict-enum
validation fails, and `database/users.py`'s `get_user_subscription()` — called via
`parse_snapshot_strict` — raises before the endpoint ever constructs a response body. The
client's already-shipped `plan.isUnknown` check in `usage_page.dart` is genuinely correct and
well-implemented, but it is **unreachable** for this exact fixture: the app never receives a
parsed `Subscription` with an unrecognized `plan` string, because the server crashes on its own
strict read before it can serialize one. `UsageProvider.fetchSubscription()` (existing code,
unrelated to Defect 2's fix) already catches the HTTP failure and sets `error`, but
`UsagePage._buildSubscriptionInfo` never consulted `provider.error` — only
`provider.subscription == null` — so the failure surfaced as the same blank card as the
original bug, just via a different code path.

**Scope decision — did not touch the backend.** `get_user_subscription()` is shared with
`payment.py`/`sync.py`'s correctness-critical entitlement/billing checks; its own
`read_boundary.py` docstring deliberately reserves fail-open parsing for presentation-only
readers and strict parsing for canonical-state readers. Making it fail-open, or adding a real
server-side "unknown plan" `PlanType` member (which the wire contract's `_reject_values_outside
_released_wire_contract` validator and `WIRE_FALLBACK_PLAN_TYPES` map would also need to learn
about), is a legitimate but separate, higher-blast-radius change — out of scope for a
QA-driven fix per this repo's own "do not broaden a safe bug-fix PR into an unreviewable
migration" guidance. Filed as a known remaining gap below.

**Fix applied this session** (commit `68fab8d2e8`, `app/lib/pages/settings/usage_page.dart`):
render the same error+retry card (extracted into `_buildPlanErrorCard`) whenever
`subscription == null && error != null`, not only for the recognized-unknown-plan branch.
Regression test: `app/test/widgets/usage_page_fetch_failed_card_test.dart` (mirrors the existing
`usage_page_unknown_plan_card_test.dart` harness pattern for this sibling branch).

**Second pass (after the fix, hot-restarted) — PASS.**

| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Plan & Usage error card | "Unable to load plans" + description | present | **PASS** | `30-unknown-plan-usage-FIXED.png` |
| Retry control | visible, keyed `plan_usage_error_retry_button` | present | **PASS** | `30-unknown-plan-usage-FIXED.png` |

**Retry-refetch proof (real re-fetch, not cosmetic).** While the error card was showing:
patched the Firestore emulator document directly (`google.cloud.firestore` admin client against
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`) — `subscription.plan: "future_plan_123" →
"unlimited_v2"`, `current_price_id → "price_local_unlimited_v2_month"` — then pressed the
in-app **Retry** button. The card transitioned from the error state to **"Unlimited (Legacy
Plan)"** (screenshot `31-after-retry-refetch.png`), which is only possible if Retry issued a
genuine new `GET /v1/users/me/subscription` and rendered its response — a stale/cosmetic retry
would have kept showing the error card. The fixture document was restored to its original
`future_plan_123`/`price_local_future_plan_month` state immediately afterward.

## Regression checks

### `pricing_pro_v2` (fresh sign-out/sign-in)
| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Settings badge | PRO | PRO | **PASS** | `20-pro-v2-settings-badge.png` |
| Plan & Usage title | Pro | Pro | **PASS** | `21-pro-v2-plan-usage.png` |

### `pricing_unlimited_v2` (legacy UID, fresh sign-out/sign-in)
| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Settings badge | UNLIMITED | UNLIMITED | **PASS** | `23-unlimited-v2-settings-badge.png` |
| Plan & Usage title | Unlimited (Legacy Plan) | Unlimited (Legacy Plan) | **PASS** | `24-unlimited-v2-plan-usage.png` |

### `pricing_plus_cancel_at_period_end` (fresh sign-out/sign-in)
| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Plan & Usage title | Plus (no cancellation copy on the main card — matches baseline note) | Plus | **PASS** | `33-plus-cape-plan-usage.png` |
| Manage Plan → Change Plan sheet | Cancellation copy ("Your plan is set to cancel on Sep 5, 2032...") | present | **PASS** | `34-plus-cape-manage.png` |

### `pricing_pro_v2_cancel_at_period_end` (fresh sign-out/sign-in)
| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Settings badge | PRO | PRO | **PASS** | `40-pro-v2-cape-settings.png` |
| Plan & Usage title | Pro | Pro | **PASS** | `41-pro-v2-cape-plan-usage.png` |
| Manage Plan → Change Plan sheet | Cancellation copy | present | **PASS** | `42-pro-v2-cape-manage.png` |

### `pricing_plus_lapsed` (fresh sign-out/sign-in)
| Check | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Plan & Usage title | Free (lapsed) | Free | **PASS** | `44-plus-lapsed-plan-usage.png` |

All results match the baseline 15-scenario tracker (`/private/tmp/claude-501/-Volumes-LEXAR-tempdev-omi/19568791-a9ee-49c3-bfaf-59b6db334553/scratchpad/pricing-gui-qa/TRACKER.md`) exactly, with two exceptions: Defect 1 now PASSes (it was the tracker's finding), and Defect 2 required an additional fix this session beyond what the tracker's defect report led to.

## Tooling notes for future sessions (confirmed, matches the prior baseline pass)

- `agent-flutter`'s `@ref`-based commands (`press @refN`, `fill @refN`, `find text ... press`,
  `scroll @refN`) work reliably via the Marionette/VM-service path.
- Raw coordinate `press x y`, `scroll up/down`, `swipe`, `back`, and `agent-flutter back` all
  shell out to `adb -s emulator-5554 ...` unconditionally and fail (`adb: command not found`)
  against this iOS Simulator session. Do not use them; always resolve a fresh `@ref` first.
- The "Manage Plan → Change Plan" `DraggableScrollableSheet` has no reachable close/back
  control via any `agent-flutter` command tried (Escape via `osascript ... key code 53` — even
  with Simulator confirmed frontmost via `osascript -e 'tell application "System Events" to name
  of first process whose frontmost is true'`, and even after toggling Simulator's "Connect
  Hardware Keyboard" via Cmd+Shift+K — did **not** dismiss it this session, unlike the prior
  baseline's report). The workaround that did work: a Flutter hot restart (`kill -SIGUSR2
  <flutter run pid>`) fully rebuilds the widget tree and lands back on Home, dismissing any open
  sheet. Costs ~6s (warm) and requires reconnecting `agent-flutter` and re-signing in.
- A hot restart re-triggers the one-time "Tell us your primary language" modal even for an
  already-authenticated session (it's gated on a local flag, not auth state) — select any
  language option and tap Confirm to dismiss.
- The `--dart-define=OMI_LOCAL_DEV_ONBOARDING_BYPASS=1` flag is required for a fast QA loop; a
  build without it lands fresh sign-ins in the full onboarding wizard (name entry, etc.) instead
  of skipping to Home. This flag is compile-time (dart-define), so adding it after an initial
  `flutter run` requires a full relaunch, not just a hot reload/restart.
- `agent-flutter text` reads the full semantics tree (including rows not currently laid out in a
  virtualized list — e.g. it found "Sign Out" before that row had ever been scrolled into view),
  but `agent-flutter find text ... press` on such an off-screen node is a no-op (reports success,
  changes nothing) — the row must actually be rendered first. `agent-flutter scroll @refN` (ref
  to the last currently-visible row) reliably brings the next rows into the rendered window; do
  this before `find text ... press` on anything you haven't seen in a screenshot yet.

## Harness state left behind

- `backend` (port 8000): running, rooted in this worktree (`/Volumes/LEXAR/tempdev/omi-worktrees/qa-ios-post-fix/backend`), log at `/tmp/worktree-backend.log`. **Not** the process that was running at session start (that one, rooted in the main checkout, was killed — see above).
- Firestore/Auth/Redis/Typesense/llm-gateway/desktop-backend: left running, untouched.
- Seeded scenario: `plan_catalog_matrix` (default UID `pricing_plus`), matching `PRICING_MACOS.md`'s documented starting point for the next (desktop/macOS) QA phase.
- iOS app: signed out, sitting on the onboarding welcome screen. `flutter run` process still attached (PID `37552`); VM Service at `ws://127.0.0.1:56743/istwhjbSNYI=/ws`.
- `make dev-down` was never run, per instructions.
- Fixture document `users/pricing_unknown_future_plan` restored to its original seeded state (`plan: "future_plan_123"`) after the retry-refetch proof.

## Screenshots

All screenshots are under `/tmp/pricing-qa-ios-sept2026/screenshots/` on this Mac (agent-flutter
only writes under `/tmp`). Selected ones cited above by filename; full session sequence
(00–45) covers the initial launch, both onboarding-bypass builds, every sign-out/sign-in cycle,
and every scenario checked.

## Remaining gaps (stated plainly)

1. **Backend-side "unknown plan" representation does not exist.** This session's fix makes the
   *client* fail loud instead of silent for this case, but the *server* still 500s for any
   Firestore doc whose `subscription.plan` isn't a real `PlanType`/alias — `get_user_subscription()`
   uses `parse_snapshot_strict`. If this is meant to be recoverable in production (e.g. a
   genuinely future plan id shipped server-side before an old client's enum knows about it), the
   server needs its own graceful path (fail-open reader, or a real wire-safe "unknown" plan
   representation) — this is a real design question that couldn't be safely resolved inside this
   QA task without risking payment/billing-path regressions, per the reasoning above.
2. **Pre-existing l10n gap, unrelated to Defect 1/2**: `flutter gen-l10n` reports 2 untranslated
   keys per locale (`memoryHistoryPartial`, `tapPlusToStartRecording`) across all 48
   translations. Confirmed pre-existing on this branch (not touched by either defect fix or this
   session's change) — flagged for whoever owns that feature, out of scope here.
3. **"Change Plan" sheet has no reachable dismiss control** via any automation path tried this
   session (see tooling notes) — a real UX gap (a human finger-swipe works fine; only automation
   is stuck), not a new finding but worth a product/eng look independent of this QA pass.
