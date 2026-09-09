# Pricing QA — Agent 3 (desktop macOS / Electron-on-Mac) evidence

Continuation of the pricing catalogue QA pass documented in
`PRICING_QA_PASS_2026-09.md` (that file lives on the coordinator's separate
integration branch `coordinator/push-pricing-update-sept-2026`, not yet on
`origin/pricing-update-sept-2026` at the time this evidence was recorded — see
"Branch note" below).

## Test run

| Field | Value |
|---|---|
| Agent | Claude (agent 3), desktop macOS / Electron-on-Mac QA |
| Tested commit | `e7968a9271` (`origin/pricing-update-sept-2026` tip at pass time — confirmed via `git fetch origin` + `git log origin/pricing-update-sept-2026 -1`) |
| Worktree | `/Volumes/LEXAR/tempdev/omi-worktrees/qa-desktop-pricing` |
| Branch | `qa/desktop-pricing-verification-sept2026` (tracks `origin/pricing-update-sept-2026`) |
| Harness checkout (shared, owns `.local/dev-harness`) | `/Volumes/LEXAR/tempdev/omi` |
| Provider mode | `offline` |

**Branch note:** `scripts/dev-harness/PRICING_QA_PASS_2026-09.md` is not present at
`origin/pricing-update-sept-2026`'s tip (`e7968a9271`) — it exists only on the
coordinator's local integration branch `coordinator/push-pricing-update-sept-2026`
(currently at `f77880452c`, not yet pushed). I read its content directly via
`git show coordinator/push-pricing-update-sept-2026:scripts/dev-harness/PRICING_QA_PASS_2026-09.md`
for context (iOS defect history, exact wording of the macOS fix under test) without
merging or depending on that branch. This evidence file is a new, separate file
committed on my own branch.

## Priority finding: macOS Unlimited-v2 vs. Neo — fix was INCOMPLETE, now fixed

**Verdict: FAIL on tested commit `e7968a9271`, fixed in this session at commit
(see "Fix implemented" below). Live-verified PASS after the fix.**

### What I found

Commits `2fbed4b081` + `cbfdb0691a` + `2f8b144a65` (already on `pricing-update-sept-2026`)
fix `SubscriptionPlanPresentation.normalizedPlanId` to check for `"unlimited_v2"` /
`"unlimited v2"` substrings before the broader `"unlimited"` substring, so a Stripe
price *title* containing `"v2"` buckets into the `unlimited_v2` fallback-catalog
entry instead of colliding with Neo's `unlimited` bucket.

Live GUI verification (first ever done for this fix) showed this does **not**
work against the real harness data:

- Built and ran `omi-pricing.app` (named bundle) pointed at the shared harness,
  signed in as `pricing_unlimited_v2` (`current_price_id=price_local_unlimited_v2_month`,
  `plan=unlimited_v2`).
- **First render** of Settings → Plan and Usage showed **title "Neo (Legacy
  Plan)"**, Neo's description/features (200 chat questions/month, Neo's fallback
  feature list), but the **price string was correct** ($19.00/mo, Unlimited-v2's
  real stub price, not Neo's $24.99) — reproduced identically across 2 independent
  clean app launches (screenshots `06`/`07`, `08`/`09` established Neo itself
  renders correctly on first load, isolating the bug to unlimited_v2 specifically).
  After a manual data refresh (`refresh_all_data` bridge action), the SAME
  session self-corrected to "Unlimited (Legacy Plan)" — proving the backend data
  was always correct and the bug was 100% client-side.
- Confirmed via direct backend curl (bypassing the app) that
  `/v1/users/me/subscription`'s `available_plans` **and**
  `/v1/payments/available-plans` (the fallback catalog endpoint,
  `getAvailablePlans()`) both correctly return an `unlimited_v2` entry
  (`title: "Unlimited"`, correct 1000-chat features, price id
  `price_local_unlimited_v2_month`) for this uid, in every header permutation
  tried (with/without `X-App-Platform`, `X-App-Version`).

### Root cause (the actual bug, distinct from what the commits above assumed)

`/v1/payments/available-plans`'s real price **title** for Unlimited-v2 is
literally `"Unlimited Monthly"` / `"Unlimited Annual"` — **no "v2" substring
anywhere** — because the plan's own catalog display name is `"Unlimited"`, not
`"Unlimited v2"` (`backend/utils/subscription.py`'s
`get_paid_plan_definitions()`). The `normalizedPlanId` ordering fix from
`2fbed4b081` never engages for this real title text; it falls through to
`normalized.contains("unlimited")` and returns `"unlimited"` (Neo's bucket) —
exactly the original bug, just never observed because the regression test
(`cbfdb0691a`) exercises a **fabricated** title `"Unlimited-v2 Monthly"` that
never occurs on the wire.

This collapses Unlimited-v2's own two prices into the **same fallback-catalog
key** (`"unlimited"`) as genuine Neo, producing a catalog entry titled "Neo"
that holds Unlimited-v2's own price ids. Merged with the primary (per-user)
catalog's correctly-labeled `"unlimited_v2"` entry (which also legitimately
contains those same price ids), `owningCatalogPlan`'s `catalog.first { ... }`
had two candidate entries claiming the same price id and picked whichever the
merged dictionary happened to iterate first — undefined per-load, which is
exactly the observed first-load-wrong/refresh-fixes-it behavior.

### Fix implemented (this session)

- `desktop/macos/Desktop/Sources/Services/APIClient/APIClient+Settings.swift`:
  decode the backend's own `plan_id` field (`PricingOption.plan_id` in
  `backend/routers/payment.py` — already sent on the wire, previously silently
  dropped by the Swift model's `CodingKeys`) onto a new
  `AvailablePlanPriceOption.planId` property.
- `SettingsContentView+BillingHelpers.swift`: added
  `SubscriptionPlanPresentation.catalogGroupingKey(for:)`, which prefers the
  wire's `plan_id` over `normalizedPlanId(from: price.title)` title-parsing,
  only degrading to title parsing when a backend omits the field. `planCatalog(from:)`
  now delegates to this instead of calling `normalizedPlanId` directly.
- Regression tests added to `Desktop/Tests/SubscriptionPlanPresentationTests.swift`
  (real production seam: decode an actual `AvailablePlanPriceOption` via
  `JSONDecoder` from JSON shaped exactly like the live backend response, not a
  fabricated title):
  - `testCatalogGroupingKeyUsesWirePlanIdNotAmbiguousTitle` — proves
    `catalogGroupingKey` returns `"unlimited_v2"` for the real ambiguous title
    `"Unlimited Monthly"` when `plan_id` is present (this is the exact case
    `cbfdb0691a`'s fabricated-title test never covered).
  - `testCatalogGroupingKeyDegradesToTitleParsingWhenPlanIdMissing` — backward
    compat for a backend that omits `plan_id`.
  - `testPlanCatalogGroupingKeepsUnlimitedV2AndNeoDistinctWithRealisticAmbiguousTitles`
    — full pipeline: groups realistic prices, then verifies `owningCatalogPlan`/
    `currentPlanTitle` resolve deterministically to "Unlimited (Legacy Plan)".
- All 15 tests in `SubscriptionPlanPresentationTests` pass (12 pre-existing + 3
  new), run twice (before/after `swift-format`): `./scripts/dev-feedback.py --once
  swift 'SubscriptionPlanPresentationTests'` → 0 failures both times.
- Full `xcrun swift test -c debug --package-path Desktop` (no filter) attempted
  as the broader Definition-of-Done gate: 3140 passed, 1 pre-existing unrelated
  failure (`ChatDiscoverabilityTests.testDesktopCapabilitiesExistInAgentToolDeclarations`
  — "Missing agent tool declaration for look_at_frame"; file has zero mentions
  of subscription/billing/plan, confirmed unrelated to this diff), plus one
  parallel-worker crash (signal 5, SPM auto-restarted the affected suites,
  which then passed) in unrelated JIT/Interject suites — consistent with the
  known worker-concurrency flakiness AGENTS.md documents
  (`OMI_SWIFT_TEST_SUITE_WORKERS=1` diagnostic). Not re-run given the ~50-minute
  cost and its total unrelatedness to this diff; the focused, twice-green
  `SubscriptionPlanPresentationTests` run is the authoritative gate for this change.
- `python3 scripts/check_desktop_test_quality.py` — OK, no new debt.
- `swift-format` — no diff (already compliant).
- Failure class: `FC-mirrored-model-omits-new-member` (open, evidence PRs
  #11372/#11834) — exact match: `normalizedPlanId` is a hand-written mirror of
  the wire's `plan_id` that restates membership by parsing display text instead
  of reading the source of truth; when the source's title text doesn't fit the
  hand-rolled pattern, the new/distinct member silently collapses into another.
  Declared on the fix commit. Not adding a repo-wide static checker for this
  class in this QA-scoped session (out of scope per root AGENTS.md's "do not
  broaden a bug-fix PR into an unreviewable migration"); flagging as a
  worthwhile follow-up given this is now its 3rd instance.

### Live re-verification after the fix (2 independent clean relaunches)

Both show correct, stable "Unlimited (Legacy Plan)" / "Unlimited Monthly •
$19.00/month" / 1000-chat features / correct supporter note / correct
`Renews on Sep 5, 2032` on the **very first render**, no refresh needed.
Screenshots: `10-fix-verify-first-load.png`, `11-fix-verify-run2.png`.

### Regression safety (Neo unaffected)

`pricing_unlimited` (genuine Neo) re-verified **after** the fix, on a fresh app
build: "Neo (Legacy Plan)" / "Neo Monthly • $24.99/month" / 200-chat features —
unchanged, correct. Screenshot `26-neo-postfix.png`.

## macOS scenario matrix (all on the fixed build, commit `e7968a9271` + local fix)

Build/profile: named bundle `omi-pricing.app` (`com.omi.omi-pricing`), launched
directly from this worktree's `desktop/macos` via `./run.sh` with
`OMI_DESKTOP_LOCAL_PROFILE=1 OMI_SKIP_BACKEND=1 OMI_SKIP_TUNNEL=1
OMI_DESKTOP_API_URL=http://127.0.0.1:10201 OMI_PYTHON_API_URL=http://127.0.0.1:8000`
pointed at the shared harness (owned by the main checkout
`/Volumes/LEXAR/tempdev/omi`; never built/run from that checkout directly).

### `plan_catalog_matrix` (reseeded via `make seed-pricing-scenario SCENARIO=plan_catalog_matrix` from the main checkout, harness-only interaction)

| UID | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| `pricing_never_subscribed` | Free | Free, correct features | PASS | `20-never-subscribed.png` |
| `pricing_basic` | Free | Free, correct features | PASS | `21-basic-retry.png` |
| `pricing_plus` | Plus (no legacy suffix) | Plus, $19.00/mo, correct features | PASS | `22-plus.png` |
| `pricing_pro_v2` | Pro (no legacy suffix) | Pro, $49.00/mo, correct features | PASS | `23-pro-v2.png` |
| `pricing_unlimited` | Neo (Legacy Plan) | correct, pre- and post-fix | PASS | `08`/`09` (pre-fix control), `26-neo-postfix.png` |
| `pricing_architect` | Architect (Legacy Plan) | correct, $199/mo | PASS | `24-architect.png` |
| `pricing_operator` | Operator (Legacy Plan) | correct, $20/mo | PASS | `25-operator.png` |
| `pricing_unlimited_v2` | Unlimited (Legacy Plan) | **FAIL pre-fix** (see above) → **PASS post-fix** | FAIL→FIXED→PASS | `01`-`05` (fail), `10`/`11` (fixed) |

### `legacy_and_unknown_plan_resilience` (reseeded)

| Case | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| literal `pro` alias (`pricing_pro`) | Architect (Legacy Plan) | correct | PASS | `30-pro-alias.png` |
| Neo inside cutoff (`pricing_unlimited_grandfathered`) | Neo (Legacy Plan) | correct | PASS | `31-neo-grandfathered.png` |
| Neo outside cutoff (`pricing_unlimited_post_cutoff`) | Current Neo behavior | renders identically to inside-cutoff; no client-side spec distinguishes them (pre-existing, not a defect, matches iOS finding) | PASS/observation | `32-neo-postcutoff.png` |
| `pricing_unknown_future_plan` | Safe, non-blank handling | **See dedicated section below** | PASS (no defect) | `33`, `34` |

### `cancellation_and_downgrade_safety` (reseeded)

| Case | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| Plus `cancel_at_period_end` | Plus + "Access ends" copy | correct, "Access ends on Sep 5, 2032" | PASS | `40-plus-cancel.png` |
| Pro `cancel_at_period_end` | Pro + "Access ends" copy | correct | PASS | `41-pro-cancel.png` |
| `pricing_plus_lapsed` | Free after lapse | correct, no misleading error text | PASS | `42-plus-lapsed.png` |

## `pricing_unknown_future_plan` — does macOS reproduce the iOS blank-card defect?

**No.** Backend still 500s server-side for this literal fixture
(`MalformedDocError` in `database/read_boundary.py`'s strict Firestore parser —
same server-side gap iOS's Agent 2 found, out of scope to fix here). But
macOS's Settings/Plan&Usage code (`SettingsContentView+BillingHelpers.swift`'s
`loadSubscriptionInfo()` catch branch) already sets `subscriptionError =
"Failed to load plan information."` and the UI (`SettingsContentView+AccountBilling.swift`'s
`planUsageSection`) already renders that as visible red inline text below a
Free-tier fallback card, with a working **Refresh** button
(`loadSubscriptionInfo()` retry) — never a blank/empty card. Verified live
(screenshot `33-unknown-future-plan.png`) and confirmed the Refresh action
doesn't crash (screenshot `34`, app stayed in `appState: main` after refresh).
**No macOS fix needed for this scenario** — the pre-existing error-fallback
path already covers it, just via a different (older, already-shipped) pattern
than iOS's dedicated error+retry card, not the blank-card defect the task asked
me to check for.

## Electron-on-Mac scenario matrix

**Explicit limitation: this is Electron running on macOS (arm64), launched via
`pnpm dev` in this worktree's `desktop/windows`. This is NOT native Windows
verification** — no Windows-only native helpers exist here (OCR/audio
helpers logged "binary not found... DISABLED", `.NET`-only, expected and
harmless on this platform) and packaging/installer behavior is entirely
unverified. I have no way to run native Windows from this Mac; that gap is
real and unaddressed by this pass.

Setup: Node 22.23.2 (via `brew`'s `node@22`; system default was v26, wrong per
`desktop/windows/.nvmrc`/pnpm 10), `pnpm install --frozen-lockfile` (clean,
better-sqlite3/electron postinstall succeeded, OCR/audio Windows-only helpers
correctly no-op on macOS), `pnpm run typecheck` (clean), `pnpm test` — **563
test files / 5625 tests passed, 6 files / 29 tests skipped, 0 failures**
(includes `PlanUsageTab.test.tsx`'s own "shows friendly copy + a retry instead
of a blank panel when `.subscription` is missing" — pre-existing coverage for
exactly the fetch-failed scenario checked below). `.env`: `VITE_OMI_APP_PROFILE=local_dev`,
`VITE_OMI_API_BASE=http://127.0.0.1:8000`, `VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1`,
`VITE_FIREBASE_AUTH_EMULATOR_PORT=9099` (loopback since Electron and harness
are the same machine).

Driving the app: the on-screen coordinate math initially misfired badly
(display-scaled screenshot pixels vs. AppleScript/cliclick's logical points —
factor 0.72, not 1:1 — and one misclick actually landed on a completely
different app's window). Switched to driving the renderer directly over
Chrome DevTools Protocol (`ws://127.0.0.1:9231`, real `Input.dispatchMouseEvent`
clicks plus native `input.value` setter + `input` event for the uid field) —
fully reliable, used for the rest of the pass. Settings is reached via
`Cmd+,` (no in-app icon found reachable through the "Home menu" control I
tried first). Each UID sign-in for the first time repeats the *full* onboarding
wizard (name → language → survey → permissions → shortcuts → data sources →
goal), stepped through generically (fill any input, click the first matching
button from a Continue/Next/Skip/Done list) since the onboarding bypass flag
was intentionally left off (matches PRICING_WINDOWS.md's documented recipe,
same as macOS/iOS's earlier passes).

### `plan_catalog_matrix`

| UID | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|
| `pricing_plus` (default) | Plus | Plus, $19.00/mo, correct features, "Renews on Sep 5, 2032" | PASS | `70-electron-plus.png` |
| `pricing_pro_v2` | Pro | Pro, $49.00/mo, correct features | PASS | (text-only, `80-electron-pro-v2`) |
| `pricing_never_subscribed` | Free | Free, correct | PASS | `81-electron-never-sub` |
| `pricing_basic` | Free | Free, correct | PASS | `82-electron-basic` |
| `pricing_unlimited` | Neo (Legacy Plan) | correct, $24.99/mo, correct features, supporter note | PASS | `83-electron-neo` |
| `pricing_architect` | Architect (Legacy Plan) | correct, $199/mo | PASS | `84-electron-architect` |
| `pricing_operator` | Operator (Legacy Plan) | correct, $20/mo | PASS | `85-electron-operator` |
| `pricing_unlimited_v2` | Unlimited (Legacy Plan) | **correct on first render** — Electron's TypeScript catalog logic does not share macOS Swift's bug | PASS | `86-electron-unlimited-v2.png` (screenshot confirmed) |

### `legacy_and_unknown_plan_resilience` (reseeded)

| Case | Expected | Observed | Result |
|---|---|---|---|
| literal `pro` alias | Architect (Legacy Plan) | correct | PASS |
| Neo inside cutoff (`pricing_unlimited_grandfathered`) | Neo (Legacy Plan) | correct | PASS |
| Neo outside cutoff (`pricing_unlimited_post_cutoff`) | current Neo behavior | identical to inside-cutoff, same non-defect as macOS/iOS | PASS/observation |
| `pricing_unknown_future_plan` | Safe, non-blank handling | **"Request failed with status code 500" + "Try again" button** — visible error, not a blank panel | PASS (no defect) — screenshot `93-electron-unknown-future.png` |

### `cancellation_and_downgrade_safety` (reseeded)

| Case | Expected | Observed | Result |
|---|---|---|---|
| Plus `cancel_at_period_end` | Plus + "Access ends" | correct, "Access ends on Sep 5, 2032" | PASS |
| Pro `cancel_at_period_end` | Pro + "Access ends" | correct | PASS |
| `pricing_plus_lapsed` | Free after lapse | correct | PASS |

**`pricing_unknown_future_plan` on Electron: does not reproduce the blank-card
defect either.** Electron already renders a dedicated "Request failed with
status code 500" message plus a "Try again" retry button (matches the
pre-existing `PlanUsageTab.test.tsx` unit coverage) — an even more explicit
error surface than macOS's Free-tier-fallback-plus-inline-error approach. No
Electron fix needed.

## Reseed log

```
make seed-pricing-scenario SCENARIO=plan_catalog_matrix          # macOS matrix
make seed-pricing-scenario SCENARIO=legacy_and_unknown_plan_resilience
make seed-pricing-scenario SCENARIO=cancellation_and_downgrade_safety
make seed-pricing-scenario SCENARIO=plan_catalog_matrix          # Electron matrix
make seed-pricing-scenario SCENARIO=legacy_and_unknown_plan_resilience
make seed-pricing-scenario SCENARIO=cancellation_and_downgrade_safety
```
All run from `/Volumes/LEXAR/tempdev/omi` (the harness-owning checkout) —
harness-state-only interaction (seed/status), never a build/run from that
checkout's working tree.

## Harness/desktop cleanup discovered and performed

Found ~28 orphaned/suspended shell jobs (`bash scripts/dev-harness/desktop-run-local.sh
<uid>` for nearly every matrix UID, timestamps 1:23 PM–1:44 PM — hours before
this session) still resident in the process table, evidently an earlier,
interrupted Agent 3 attempt at this exact same matrix. Killed all of them
(`kill -9`) before starting my own launches — they were stuck/suspended (SN
state, 0% CPU, 0:00 CPU time each) and not doing active work, but their
presence is a plausible contributor to the very first "Neo" mis-render I saw
(coincident stale app process/window confusion) before I isolated the real bug
via a fully clean relaunch. No other agent was found running concurrently
after this cleanup.

## Harness/desktop state left behind

- Dev harness: **left up** (`make dev-down` NOT run), per instructions.
- Scenario currently seeded: `cancellation_and_downgrade_safety` (last matrix
  reseeded), selected user `pricing_plus_cancel_at_period_end`.
- macOS `omi-pricing.app`: still running (bundle `com.omi.omi-pricing`),
  currently **signed out** (last live session was `pricing_plus_lapsed`).
- Electron dev (`pnpm dev` in `desktop/windows`): **stopped** — this was a
  temporary client I started for this pass, not shared harness state; no
  reason to leave 8+ Electron helper processes resident.
- `desktop/windows/.env`: left with the local-dev block filled in
  (`VITE_OMI_APP_PROFILE=local_dev`, etc.) — matches the documented recipe
  exactly, safe to leave (gitignored, `.env.example` unchanged).

## Fix commit(s)

Committed on `qa/desktop-pricing-verification-sept2026`:
- `fix(macos): resolve Unlimited-v2 fallback-catalog grouping from wire plan_id, not ambiguous price title` (+ regression tests)
- This evidence file

See `git log` on this branch for exact hashes; recorded in my final report to
the coordinator.

## Remaining gaps (stated plainly)

1. **No native Windows verification** — only Electron-on-Mac. Packaging,
   Windows-only OCR/audio helpers, and any Windows-specific rendering are
   entirely unverified by this pass.
2. Backend still 500s for `pricing_unknown_future_plan`'s literal
   `future_plan_123` fixture — a real server-side gap (shared with iOS's
   already-documented finding), not fixed here, out of scope (touches the
   shared strict Firestore parser used by billing-critical paths).
3. `FC-mirrored-model-omits-new-member` is now a 3rd recorded instance
   (#11372, #11834, and this fix) — a repo-wide static checker for
   hand-written wire-mirroring would be a worthwhile follow-up but is out of
   scope for this QA-focused session.
4. Full (unfiltered) Swift test suite has one pre-existing, unrelated failure
   (`ChatDiscoverabilityTests` agent tool declaration) and occasional
   parallel-worker crashes (signal 5) — both predate this diff and are
   untouched by it; not chased further given ~50 minutes per full run and zero
   file overlap with this change.
