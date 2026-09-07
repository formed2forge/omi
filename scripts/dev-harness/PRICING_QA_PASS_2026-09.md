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
| Integration preflight (`make preflight`) | **FAILED** at `dev-harness-unit-tests` | `scripts/dev-harness/tests/test_env_stage.py::test_nondefault_port_offset_propagates_to_every_harness_service`. Root cause: the test calls `config.load_config(REPO_ROOT, env={"OMI_HARNESS_PORT_OFFSET": "321"})` without a `PROVIDER_MODE` key, so `providers.provider_mode_from_env` (scripts/dev-harness/dev_harness/providers.py:219) defaults to `"real"` as the test expects — but the test also omits the `OMI_LOCAL_STATE_ROOT` isolation seam that sibling tests use (see `test_cli.py`'s `monkeypatch.setenv("OMI_LOCAL_STATE_ROOT", ...)`), so `load_config`'s `parse_secrets_file(cfg)` (dev_harness/config.py:335) reads whatever ambient secrets file the *running* machine's harness state root points at. When that ambient file declares `PROVIDER_MODE=offline` (true on a harness "left seeded" in offline mode, per this task's starting evidence), `load_config` silently overrides `cfg.provider_mode` to `offline`, flipping `OMI_LLM_GATEWAY_FEATURE_MODE` to `off` and failing every gateway-mode assertion. Assigned to Agent 1 (harness test repair). |

## Scenario results

`plan_catalog_matrix` is the minimum complete pass. Legend: `PASS` / `FAIL` /
`BLOCKED` / `NOT RUN`. Pre-fix results (recorded before the Settings-badge and
unknown-plan fixes landed) are labeled **(pre-fix)** and must be re-verified
against current HEAD before being trusted for sign-off.

| Scenario | UID / case | Expected result | iOS | macOS | Windows/Electron | Notes |
|---|---|---|---|---|---|---|
| `plan_catalog_matrix` | `pricing_never_subscribed` | Free | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `plan_catalog_matrix` | `pricing_basic` | Free | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `plan_catalog_matrix` | `pricing_plus` | Plus | PASS Plan&Usage / FAIL Settings badge (pre-fix) | NOT RUN | NOT RUN | Fix on branch: `c9636e1e29`. Needs post-fix re-verify (Agent 2). |
| `plan_catalog_matrix` | `pricing_pro_v2` | Pro | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `plan_catalog_matrix` | `pricing_unlimited` | Neo (Legacy Plan) | PASS (pre-fix) | NOT RUN | NOT RUN | macOS Unlimited-v2-vs-Neo identity fix on branch (`2fbed4b081`,`cbfdb0691a`,`2f8b144a65`) — macOS is the priority platform for this UID (Agent 3). |
| `plan_catalog_matrix` | `pricing_architect` | Architect (Legacy Plan) | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `plan_catalog_matrix` | `pricing_operator` | Operator (Legacy Plan) | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `plan_catalog_matrix` | `pricing_unlimited_v2` | Unlimited (Legacy Plan) | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `legacy_and_unknown_plan_resilience` | literal `pro` | Architect alias, legacy labeling | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `legacy_and_unknown_plan_resilience` | Neo inside cutoff | Neo legacy labeling | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `legacy_and_unknown_plan_resilience` | Neo outside cutoff | Current Neo behavior | PASS/observation (pre-fix) | NOT RUN | NOT RUN | Renders identically to inside-cutoff case; no client-side spec distinguishes them. Not treated as a defect. |
| `legacy_and_unknown_plan_resilience` | `future_plan_123` | Safe unknown-plan handling | FAIL (pre-fix) | NOT RUN | NOT RUN | Blank Plan & Usage card, no fallback. Fix on branch: `9df791c20c`,`a41fc3c710`,`93e64de0c4`. Needs post-fix re-verify incl. retry control (Agent 2). |
| `cancellation_and_downgrade_safety` | Plus, `cancel_at_period_end` | Plus with cancellation state | PASS (pre-fix) | NOT RUN | NOT RUN | Cancellation copy only shown one level deep (Manage Plan sheet), not a defect. |
| `cancellation_and_downgrade_safety` | Pro, `cancel_at_period_end` | Pro with cancellation state | PASS (pre-fix) | NOT RUN | NOT RUN | |
| `cancellation_and_downgrade_safety` | `pricing_plus_lapsed` | Free after lapse | PASS (pre-fix) | NOT RUN | NOT RUN | Entitlement correct; no in-app "why" explanation is a pre-existing UX gap, not a new defect. |

## Confirmed defects

**Defect 1 — Settings drawer plan badge showed PRO for a Plus account (iOS).**
UID `pricing_plus`. Fixed on `pricing-update-sept-2026` at `c9636e1e29`
("fix(settings): show correct plan tier badge for Plus and other paid
plans"). Regression test included in that commit. **Status: fix on branch,
post-fix GUI re-verification pending (Agent 2).**

**Defect 2 — Unrecognized/future plan id rendered a blank Plan & Usage card (iOS).**
UID `pricing_unknown_future_plan` (wire `plan: "future_plan_123"`). Fixed on
`pricing-update-sept-2026` at `9df791c20c` + `a41fc3c710` (fixup) +
`93e64de0c4` (regression test) — "fix(app): show explicit error state for
unknown/unrecognized plans". **Status: fix on branch, post-fix GUI
re-verification pending, including confirming retry actually re-fetches
(Agent 2).**

**Companion fix — macOS Unlimited-v2 vs. genuine Neo identity (not from this
defect list but bundled in the same pass).** Fixed at `2fbed4b081`
("fix(macos): resolve Unlimited-v2 plan identity from currentPriceId, not
wire plan value"), `cbfdb0691a` (regression test), `2f8b144a65` (separator
normalization fixup). **Status: fix on branch, full macOS GUI verification
pending (Agent 3), including title/description/features/price.**

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
