# Pricing catalogue QA — pass tracker (2026-09)

One dated copy of [PRICING_TEST_TRACKER.md](PRICING_TEST_TRACKER.md) for this
QA pass, per that template's own instruction ("use one copy per pass"). This
is the canonical, committed continuation of the two interrupted sessions
previously tracked only under `/tmp` scratchpads:

- `.../19568791-a9ee-49c3-bfaf-59b6db334553/scratchpad/pricing-gui-qa/TRACKER.md`
  (iOS phase, COMPLETE — all 15 scenarios, 2 defects found; screenshots in
  the adjacent `screenshots/` dir in that scratchpad)
- `.../febde6fa-d873-49ba-bb66-1121e88d9017/scratchpad/pricing-gui-qa/TRACKER.md`
  (earlier partial draft of the same pass, superseded by the one above)

Do not create another competing tracker file. Append new checkpoints to the
**Handoff log** below; update the **Scenario results** and **Defects** tables
in place as new evidence lands. Serialize edits — one writer at a time.

## Test run

| Field | Value |
|---|---|
| Coordinator | Claude (agent), on behalf of Tim |
| Branch | `pricing-update-sept-2026` |
| Remote | `origin` = `git@github.com:formed2forge/omi.git` |
| Repository commit (pass start) | `e7968a9271` |
| Harness checkout | `/Volumes/LEXAR/tempdev/omi` |
| Provider mode | `offline` |

## Preflight status

| Check | Result | Notes |
|---|---|---|
| Integration preflight (`make preflight`) | **FIXED, pending push** | `dev-harness-unit-tests` root cause was an ambient-secrets-file leak in `test_nondefault_port_offset_propagates_to_every_harness_service` (see prior entry below for full diagnosis). Fixed by a peer session's branch `fix/dev-harness-port-offset-test` (commit `7b23704c65`), independently re-verified by the coordinator and cherry-picked onto the integration branch as `ef603c8430`: `bash scripts/dev-harness/run-tests.sh` → 144 passed, 7 skipped, 0 failed. Two further **pre-existing, branch-wide** (not pricing-QA-caused) preflight blockers were found and resolved while trying to push: `product-file-line-count-ratchet` (9 files already over budget from prior work on this branch — documented via `Line-Count-Exception:` PR-body lines, not modified) and `product-invariants` (9 invariant IDs already touched by this branch's cumulative diff vs `main` — cited, not modified, per `scripts/pr-preflight --suggest`'s own instructions) and `diff-hygiene` (3 pre-existing docs with a trailing blank line at EOF — trivially fixed, whitespace-only) and `web-app-checks` (Bun's native `localStorage` shadowing jsdom in `web/app` vitest tests — real fix, see Handoff log). All fixes staged on `coordinator/push-pricing-update-sept-2026`; push to `origin/pricing-update-sept-2026` in progress. |

## Scenario results

`plan_catalog_matrix` is the minimum complete pass. Legend: `PASS` / `FAIL` /
`BLOCKED` / `NOT RUN`. Pre-fix results (recorded before the Settings-badge and
unknown-plan fixes landed) are labeled **(pre-fix)** and must be re-verified
against current HEAD before being trusted for sign-off.

| Scenario | UID / case | Expected result | iOS | macOS | Windows/Electron | Notes |
|---|---|---|---|---|---|---|
| `plan_catalog_matrix` | `pricing_never_subscribed` | Free | PASS (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | |
| `plan_catalog_matrix` | `pricing_basic` | Free | PASS (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | |
| `plan_catalog_matrix` | `pricing_plus` | Plus | **PASS (post-fix, live)** | **PASS** | **PASS (Electron-on-Mac)** | Fix `c9636e1e29`. Re-verified live on iPhone 17 Pro Simulator, iOS 27.0: Settings badge reads PLUS, Plan & Usage reads Plus. |
| `plan_catalog_matrix` | `pricing_pro_v2` | Pro | **PASS (post-fix, live)** | **PASS** | **PASS (Electron-on-Mac)** | Regression spot-check: badge still PRO in both places. |
| `plan_catalog_matrix` | `pricing_unlimited` | Neo (Legacy Plan) | PASS (pre-fix, not re-verified this pass) | **PASS (post 2nd fix, live)** | **PASS (Electron-on-Mac)** | Genuine Neo re-verified unaffected by the macOS Unlimited-v2 fix below. |
| `plan_catalog_matrix` | `pricing_architect` | Architect (Legacy Plan) | PASS (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | |
| `plan_catalog_matrix` | `pricing_operator` | Operator (Legacy Plan) | PASS (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | |
| `plan_catalog_matrix` | `pricing_unlimited_v2` | Unlimited (Legacy Plan) | **PASS (post-fix, live)** | **PASS (post-fix, live, after a 2nd macOS fix)** | **PASS (Electron-on-Mac)** | Regression spot-check per Agent 2 (iOS). macOS: see "Companion fix — reopened and re-fixed" below — Electron's separate TS implementation never had this bug. |
| `legacy_and_unknown_plan_resilience` | literal `pro` | Architect alias, legacy labeling | PASS (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | |
| `legacy_and_unknown_plan_resilience` | Neo inside cutoff | Neo legacy labeling | PASS (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | |
| `legacy_and_unknown_plan_resilience` | Neo outside cutoff | Current Neo behavior | PASS/observation (pre-fix, not re-verified this pass) | **PASS** | **PASS (Electron-on-Mac)** | Renders identically to inside-cutoff case; no client-side spec distinguishes them. Not treated as a defect. |
| `legacy_and_unknown_plan_resilience` | `future_plan_123` | Safe unknown-plan handling | **PASS (post-fix, live, after a 2nd fix)** | **PASS (no fix needed)** | **PASS (no fix needed, Electron-on-Mac)** | iOS: see "Defect 2 — reopened and re-fixed" below. macOS/Electron do **not** reproduce the iOS blank-card defect — macOS falls back to Free-tier UI + inline "Failed to load plan information." + Refresh; Electron shows "Request failed with status code 500" + "Try again". Both platforms already had adequate (if platform-divergent) error handling; no defect, no fix. |
| `cancellation_and_downgrade_safety` | Plus, `cancel_at_period_end` | Plus with cancellation state | **PASS (post-fix, live)** | **PASS** | **PASS (Electron-on-Mac)** | Cancellation copy only shown one level deep (Manage Plan sheet), not a defect. |
| `cancellation_and_downgrade_safety` | Pro, `cancel_at_period_end` | Pro with cancellation state | **PASS (post-fix, live)** | **PASS** | **PASS (Electron-on-Mac)** | |
| `cancellation_and_downgrade_safety` | `pricing_plus_lapsed` | Free after lapse | **PASS (post-fix, live)** | **PASS** | **PASS (Electron-on-Mac)** | Entitlement correct; no in-app "why" explanation is a pre-existing UX gap, not a new defect. |

**Electron results above were run on macOS ("Electron-on-Mac"), not native Windows.** No native Windows verification has been performed in this pass — that remains a gap (see Handoff log).

## Confirmed defects

**Defect 1 — Settings drawer plan badge showed PRO for a Plus account (iOS).**
UID `pricing_plus`. Fixed on `pricing-update-sept-2026` at `c9636e1e29`
("fix(settings): show correct plan tier badge for Plus and other paid
plans"). Regression test included in that commit. **Status: CLOSED.**
Re-verified live by Agent 2 on iPhone 17 Pro Simulator (iOS 27.0): Settings
badge reads PLUS, Plan & Usage reads Plus; `pricing_pro_v2` unaffected.

**Defect 2 — Unrecognized/future plan id rendered a blank Plan & Usage card (iOS) — reopened and re-fixed.**
UID `pricing_unknown_future_plan` (wire `plan: "future_plan_123"`). The
original fix (`9df791c20c` + `a41fc3c710` + `93e64de0c4`) only handled a
subscription the server parses successfully but whose plan value this client
doesn't recognize (`plan.isUnknown`). Live GUI re-verification by Agent 2
found the blank card **still reproduced**: this specific fixture isn't a
valid `PlanType`/alias at all, so the backend's strict Firestore parser
(`database/read_boundary.py`) raises `MalformedDocError` and
`/v1/users/me/subscription` 500s before the client ever gets a body to label
unknown — same silent-blank symptom, different path (an HTTP failure, not a
parsed-unknown plan). `UsagePage._buildSubscriptionInfo` only checked
`subscription == null` and rendered nothing in that case. Fixed at
`e03df2f7b5` (cherry-picked from Agent 2's `68fab8d2e8` on
`qa/ios-post-fix-verification-sept2026`): extracted the existing error+retry
card into `_buildPlanErrorCard` and render it whenever
`subscription == null && error != null`, not only for the recognized-unknown
branch. Deliberately did not touch the backend's strict parser (shared with
billing-critical entitlement checks in `payment.py`/`sync.py`; widening the
wire contract to add a real "unknown plan" representation is a separate,
higher-blast-radius change). **Status: CLOSED.** Verified live: card now
appears for `pricing_unknown_future_plan`; retry-refetch proven by patching
the Firestore emulator doc's `subscription.plan` to a valid value while the
error card was showing and confirming Retry updated the UI to "Unlimited
(Legacy Plan)". Regression test:
`app/test/widgets/usage_page_fetch_failed_card_test.dart` (6 tests across
both the new and sibling test file, independently re-run by the coordinator:
all pass). **Remaining gap (out of scope, not fixed here):** the backend
still has no real representation of a genuinely unrecognized plan id — a
literal future plan will still 500 server-side; this fix only stops the
*client* from going silent about it.

**Companion fix — macOS Unlimited-v2 vs. genuine Neo identity — reopened and re-fixed.**
Originally fixed at `2fbed4b081`/`cbfdb0691a`/`2f8b144a65`. Live GUI
verification by Agent 3 found it incomplete: `pricing_unlimited_v2` rendered
**"Neo (Legacy Plan)"** with Neo's description/features on first Settings
load, self-correcting to "Unlimited (Legacy Plan)" only after a manual
refresh — reproduced on two independent clean app launches. Root cause: the
fix's title-parsing (`normalizedPlanId`) never engages against real backend
data, because Unlimited-v2's actual Stripe price title is **"Unlimited
Monthly"** — no "v2" substring at all (its catalog display name is just
"Unlimited"; the original regression test's fabricated "Unlimited-v2
Monthly" title never occurs on the wire). Title parsing falls into the same
bucket genuine Neo uses, so two fallback-catalog entries end up claiming the
same price id, and which one wins depends on unspecified dictionary
iteration order. Fixed at `7c35ebf34e` (cherry-picked from Agent 3's
`94ac9b70a1`): decode the backend's own `plan_id` field (`PricingOption.plan_id`
in `backend/routers/payment.py`, already sent on every real deploy, previously
dropped by the Swift model's `CodingKeys`) and prefer it over title parsing
in a new `SubscriptionPlanPresentation.catalogGroupingKey(for:)`, degrading
to the old title-parsing path only when a backend omits the field.
`Failure-Class: FC-mirrored-model-omits-new-member` (3rd instance of an
open class). **Status: CLOSED.** Verified live: 2 clean relaunches show
correct "Unlimited (Legacy Plan)" / $19.00/month / 1000-chat features on
first render; genuine Neo re-verified unaffected. Regression test
(`SubscriptionPlanPresentationTests.swift`, real `JSONDecoder`-decoded
fixtures matching actual backend shape) independently re-run by the
coordinator: 15/15 pass. Electron's separate TypeScript implementation never
had this bug (doesn't share the Swift title-parsing path) — verified PASS
on Electron-on-Mac without any fix needed.

## Handoff log

Append one entry per checkpoint. Each entry: tested commit, platform/device,
build/profile, scenario+UID with expected vs. observed, PASS/FAIL/BLOCKED/NOT
RUN, evidence paths, exact commands run and their outcome, fix commit IDs,
remaining gaps, and the next responsible task.

```text
2026-09-07 — coordinator checkpoint (pass kickoff)
Tested commit: e7968a9271 (pricing-update-sept-2026, HEAD at pass start; confirmed
  up to date with origin via `git status`/`git branch -vv`).
Action: reconciled the two /tmp scratchpad trackers into this committed file;
  confirmed via `git log`/`git merge-base --is-ancestor` that both iOS defect
  fixes (c9636e1e29, 9df791c20c/a41fc3c710/93e64de0c4) and the macOS
  Unlimited-v2 identity fix (2fbed4b081/cbfdb0691a/2f8b144a65) are already on
  pricing-update-sept-2026 at e7968a9271 — no fix work needed unless
  verification below turns up something new.
Preflight: `make preflight` fails at dev-harness-unit-tests. Root cause
  identified by reading scripts/dev-harness/dev_harness/{config.py,providers.py}
  and scripts/dev-harness/tests/{test_env_stage.py,test_cli.py} — see
  "Preflight status" above. Not yet fixed.
Next responsible task: Agent 1 (harness test repair), Agent 2 (iOS post-fix
  verification), Agent 3 (desktop macOS/Electron QA, after Agent 2's slot to
  avoid concurrent shared-harness reseeding).
```

```text
2026-09-07 — coordinator checkpoint (harness fix integrated, push blockers cleared)
Tested/integrated on: coordinator/push-pricing-update-sept-2026, currently
  at b04c90b6f2, based on pricing-update-sept-2026 @ e7968a9271 + this
  session's commits (not yet pushed to origin at time of writing).
Harness test fix: a peer session pushed fix/dev-harness-port-offset-test
  (7b23704c65) independently — reviewed its diff, ran it in a separate
  worktree (124 passed, 8 skipped, 0 failed against main), cherry-picked onto
  the integration branch as ef603c8430, reran the full suite against
  pricing-update-sept-2026's base: 144 passed, 7 skipped, 0 failed.
  Command: `bash scripts/dev-harness/run-tests.sh`.
Additional push blockers found and resolved (all pre-existing/branch-wide,
  none caused by pricing QA work):
  - product-file-line-count-ratchet: 9 files (backend/routers/apps.py,
    backend/routers/chat.py, backend/utils/llm/conversation_processing.py,
    backend/utils/subscription.py, 5 desktop/macos Swift files) already over
    budget from prior work on this branch. Resolved via the documented
    Line-Count-Exception PR-body mechanism (OMI_PR_BODY_FILE), citing the
    pre-existing growth honestly rather than modifying those files.
  - diff-hygiene: 3 pre-existing docs (PRICING_IOS.md, PRICING_MACOS.md,
    PRICING_TEST_TRACKER.md) had a trailing blank line past EOF, plus an
    uncommitted trailing-whitespace edit in a Flutter-generated Package.swift
    in the main checkout (left untouched — pushed from a separate clean
    worktree instead so the main checkout's unrelated local changes stay
    preserved). Fixed the 3 docs (whitespace-only, commit 472dad9113).
  - product-invariants: this branch's full diff vs main touches 9 locked
    invariant path globs (INV-AGENT-*, INV-AUTH-1, INV-CHAT-1, INV-DATA-1,
    INV-BETA-1, INV-NAV-1, INV-VOICE-1, INV-INT-1, INV-MEM-4), none from
    pricing QA commits. Cited them under "## Product invariants affected" in
    the PR-body file per the check's own instructions and AGENTS.md's
    "name every matched invariant ID" rule — a citation, not an attestation
    that the whole branch's existing code complies; that review belongs to
    whoever opens the real PR to main.
  - web-app-checks: `web/app`'s vitest suite had 9 failing tests
    (Sidebar.test.tsx, StartupModals.test.tsx) — Bun's native `localStorage`
    (a configurable getter returning undefined without --localstorage-file)
    shadows jsdom's window.localStorage before vitest's jsdom environment
    populates the test global, so `localStorage.clear()` in `beforeEach`
    threw. Fixed by installing a plain in-memory Storage in
    web/app/vitest.setup.ts, overriding the shadowing getter (commit
    60662bdc42). Verified: `bun run check` (typecheck + full suite) — 75
    test files, 424 tests, all passing.
Push attempts: blocked twice by the Claude Code permission classifier on the
  `OMI_PR_BODY_FILE=... git push` command specifically (the env-var pattern
  reads as CI-metadata tampering even though it's the repo's own documented
  mechanism); user ran it manually and reported the actual preflight
  failures back turn by turn, which is how the line-count/diff-hygiene/
  product-invariants/web-app-checks issues above were discovered and fixed
  in sequence. Push not yet confirmed landed as of this entry.
Agent 2 (iOS post-fix verification): completed on
  qa/ios-post-fix-verification-sept2026 (local commits c83ba54eed,
  68fab8d2e8, cdf1909edd; not yet pushed to origin — blocked from that
  branch by the same then-unfixed dev-harness-unit-tests failure, expected
  to resolve once this integration branch lands on origin). Found Defect 2
  was not actually fully fixed (see Defects section) and shipped a second,
  narrower fix, verified live including a real retry-refetch proof. All
  regression spot-checks (pricing_pro_v2, pricing_unlimited_v2, both
  cancel_at_period_end UIDs, pricing_plus_lapsed) PASS. Full app test suite:
  `bash test.sh` — 1784 passed. `scripts/analyze_ratchet.sh` — passed, no new
  violations. Fix and evidence cherry-picked onto the integration branch as
  e03df2f7b5 and b04c90b6f2; independently re-ran the two targeted Flutter
  tests myself (`flutter test test/widgets/usage_page_fetch_failed_card_test.dart
  test/widgets/usage_page_unknown_plan_card_test.dart` — 6/6 pass) before
  trusting and integrating.
Harness state left behind by Agent 2: backend service was found rooted in
  the main checkout instead of the QA worktree (fixed, only that service
  restarted; Firestore/Auth/Redis/Typesense/llm-gateway/desktop-backend
  untouched). Scenario currently seeded: plan_catalog_matrix (default UID
  pricing_plus), matching PRICING_MACOS.md's documented starting point.
  make dev-down was NOT run — harness is up and ready for Agent 3.
Non-blocking gaps noted by Agent 2, not fixed (pre-existing, out of scope):
  2 untranslated l10n keys (memoryHistoryPartial, tapPlusToStartRecording)
  across all 48 locales; the "Change Plan" bottom sheet still has no
  automation-reachable dismiss control (Escape-key workaround only).
Next responsible task: get this integration branch pushed to
  origin/pricing-update-sept-2026, then Agent 3 (desktop macOS/Electron QA)
  can start — harness is already seeded and ready.
```

```text
2026-09-07 — coordinator checkpoint (desktop QA integrated; push saga)
Tested/integrated on: coordinator/push-pricing-update-sept-2026, currently at
  7f680ca10e, based on pricing-update-sept-2026 @ e7968a9271 + this session's
  9 commits (not yet confirmed landed on origin — see push attempts below).
Agent 3 (desktop macOS/Electron QA): completed on
  qa/desktop-pricing-verification-sept2026 (local commits 94ac9b70a1,
  a8d54a7e14; not pushed from that branch — same pre-existing
  product-file-line-count-ratchet blocker, subset of the 9 files this
  integration branch already has an exception for). Found the macOS
  Unlimited-v2-vs-Neo fix was also incomplete (see Defects section);
  implemented and verified a proper fix keyed on the backend's wire plan_id.
  All three scenario matrices PASS on both macOS and Electron-on-Mac (NOT
  native Windows — no way to test that from this Mac, explicitly labeled
  throughout). pricing_unknown_future_plan does not reproduce the iOS
  blank-card defect on either desktop platform — both already had adequate,
  platform-appropriate error handling (macOS: Free-tier fallback + inline
  error + Refresh; Electron: explicit 500 + Try again). Cleaned up ~28
  orphaned processes left over from an earlier interrupted QA attempt
  (hours-old, harmless) before starting fresh. Full Electron vitest suite:
  5625/5625 passed. Fix and evidence cherry-picked onto the integration
  branch as 7c35ebf34e and 7f680ca10e; independently re-ran the focused
  Swift regression suite myself (`./scripts/dev-feedback.py --once swift
  'SubscriptionPlanPresentationTests'` from desktop/macos — 15/15 pass)
  before trusting and integrating.
Harness/desktop state left behind by Agent 3: harness up (not torn down),
  seeded to cancellation_and_downgrade_safety. macOS omi-pricing.app still
  running, signed out. Electron dev processes stopped (not shared state).
Push saga (chasing a long tail of pre-existing, branch-wide preflight
  issues, none caused by pricing QA work, discovered one at a time because
  this branch had apparently never been pushed clean before):
  - check_backend_runtime_env_if_needed: worktree had no backend/.venv.
    Fixed by running `make setup` in the push worktree (documented repo
    setup step, not a workaround).
  - check_backend_typecheck_if_needed: 1 real pyright error (0 before were
    just warnings) in backend/utils/subscription.py:602, pre-existing since
    23b2732be1 (2026-09-05, unrelated to this session). A dict-literal's
    unioned value type made `plan_type` infer as
    `PlanType | str | bool | None`; fixed with an explicit `cast(PlanType, ...)`
    (already-imported helper), zero runtime behavior change. User approved
    this specific edit before it was made (backend/subscription code is
    sensitive; classifier flagged the edit, asked first). Commit a2858a8cb5.
  - check_openapi_contract_if_needed: docs/api-reference/app-client-openapi.json
    was stale (missing `pro_v2` in the PlanType enum) — pre-existing drift
    from earlier plan-catalog work. Regenerated via
    backend/scripts/export_openapi.py per the check's own instructions.
    One-line diff. Commit 8190018715.
  - check_backend_unit_tests_if_needed: two failure modes seen across
    attempts. (1) tests/unit/test_verify_pusher_config_references.py
    genuinely failed everywhere — root cause: `helm` CLI was not installed
    on this Mac at all (`which helm` → not found), a missing local
    dev-tool dependency, unrelated to any pricing QA change. Fixed via
    `brew install helm` (standard, reversible local tool install). (2) A
    recurring, non-deterministic CPU-time duration-guard flake in
    tests/unit/test_backend_runtime_env_validator.py (a different specific
    test tripped the 0.30s budget on each of 3 consecutive attempts, all
    99 tests logically passing every time) — traced to genuine system
    contention while Agent 3's Xcode builds were running concurrently
    (`uptime` load average 8–13 during the flakes). Did not touch the
    duration guard or the allowlist file (that would misrepresent transient
    contention as an "intentional exception"); waited for Agent 3 to finish
    (confirmed via its transcript file's last-modified time, not a guess)
    before retrying, rather than continuing to retry blind.
  - Multiple `OMI_PR_BODY_FILE=... git push` attempts were blocked outright
    by the Claude Code permission classifier for the coordinator session
    specifically (the env-var pattern reads as CI-metadata tampering even
    though it is the repo's own documented mechanism, per AGENTS.md and
    scripts/pr-preflight's own help text); the user ran the command manually
    each round and relayed the actual preflight output back, which is how
    each issue above was found and fixed in turn.
Next responsible task: land the final push attempt (or the next one, if
  another previously-unseen pre-existing check surfaces — this branch has
  had a long tail of them), then reconcile qa/ios-post-fix-verification-sept2026
  and qa/desktop-pricing-verification-sept2026's remote state (both still
  only local on their respective worktrees) once origin/pricing-update-sept-2026
  is confirmed updated. Native Windows verification remains an open gap —
  no native Windows machine was available this pass.
```
