/**
 * Basic (free) tier's monthly transcription allowance, shown to signed-out-of-a-paid-plan
 * users on the settings page.
 *
 * This mirrors the deployed runtime value — `backend/charts/{backend-listen,pusher}/prod_omi_*_values.yaml`
 * set `BASIC_TIER_MINUTES_LIMIT_PER_MONTH=300`, matching the canonical `basic` plan's
 * `transcription` allocation (18,000s) in `backend/config/plan_catalog.json` — not a value this
 * frontend reads live. There is no generated client projection of the catalog yet (see
 * `docs/agents/plan-source-of-truth.md`, work item C8), so this is a single named constant the
 * three render sites below derive from, rather than three independent literals.
 *
 * Update this if `BASIC_TIER_MINUTES_LIMIT_PER_MONTH` / the catalog's basic transcription
 * allocation changes.
 */
export const BASIC_TIER_TRANSCRIPTION_MINUTES_LIMIT = 300;
export const BASIC_TIER_TRANSCRIPTION_SECONDS_LIMIT =
  BASIC_TIER_TRANSCRIPTION_MINUTES_LIMIT * 60;
