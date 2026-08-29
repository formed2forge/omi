# Plan catalog audience

Canonical identity, billed price identity, entitlements, allocations, and migration ownership are in
`backend/config/plan_catalog.json` and `docs/agents/plan-source-of-truth.md`. This page owns only storefront audience
behavior. Do not add plan values or Stripe IDs here.

Locked purchase-catalog rules. Tests in
`backend/tests/unit/test_subscription_restructure.py` and
`app/test/utils/plan_pricing_test.dart` enforce them. Do not re-widen a
filter because a paid user "might want to resubscribe" or because the
phone sheet looks empty.

## Storefronts

**Rewritten for full Core/Plus/Max unification** (formed2forge/handoffs
`omi-pricing.md` §3 item 1, §24 Stage 0) — Plus and Max now sell identically
on every storefront; this replaced the old per-surface split rather than
re-parameterizing it, because the old rule (2) below assumed desktop and
mobile always sold *different* plan sets.

| Surface | Sells | Does not sell |
|---|---|---|
| Mobile (`ios` / `android`) | Plus + Max + Unlimited (`unlimited_v2`) | Operator, Architect (sunset), Neo |
| Desktop (`macos` / `windows`) | Plus + Max | Operator, Architect (sunset), Unlimited, Neo |
| Web | Plus + Max + Unlimited | Operator, Architect (sunset), Neo |

Hidden/shown is derived directly from each plan's catalog `storefronts` list
(`PLAN_STOREFRONTS`), not a hand-maintained per-platform set — see
`_platform_hidden_plans` in "Where the code lives" below.

Neo (`PlanType.unlimited`) is the deprecated pre-Plus Unlimited. Operator and
Architect are **sunset**: both still exist as billed identities (plan IDs are
append-only) with their entitlements completely unchanged for existing
subscribers, but neither is a new-user SKU on any storefront anymore,
including web — that's a real behavior change from before, when web sold
every plan. Core (`basic`) is not a purchase-catalog entry (it's the
always-available zero-cost floor) and is unaffected by this table.

## Four audience rules

1. **Neo is current-Neo only.** Show Neo iff `current_plan == unlimited`
   (active or cancel-at-period-end). Do **not** key it off "has ever
   paid" / Stripe customer id. That leak put Neo on Architect and Plus
   sheets, where Plus looked strictly cheaper because Neo's simplified
   mobile card omits unlimited transcription.
   Fully churned ex-Neo users are `basic` and get the current Plus + Max +
   Unlimited catalog. Do not bring Neo back for them.

2. **A desktop-entitled plan not sold on mobile is manage-only there.** An
   Operator or Architect subscriber opening iOS/Android sees **only** their
   current plan (Active, cancel, portal): they cannot Continue onto any
   other tier, because immediate Stripe proration would strip desktop
   entitlement. Plus and Max are desktop-entitled *and* mobile-sold now, so
   this does **not** apply to them — a Plus/Max subscriber on mobile sees the
   normal purchase catalog, including switching between Plus and Max.
   The upgrade API (`desktop_to_consumer_plan_change_error`) is the same
   boundary and needed no change: it already keys off desktop entitlement,
   not storefront membership, so it naturally still blocks any
   desktop-entitled → non-desktop-entitled swap (e.g. Plus/Max → Unlimited-v2).
   Confirmation in the app is not an exception to either guard.

3. **Sunset siblings no longer cross-shop.** Operator and Architect used to
   allow switching between each other on desktop/web (`Operator <-> Architect
   stays allowed`) because both were live, sold, sibling tiers. Now that both
   are sunset identically, that carve-out is gone: each is visible only to
   its own current subscriber (the same "deprecated, current-subscriber-only"
   shape Neo already had), who is offered the current Plus/Max catalog to
   upgrade into, or cancel — same as any other legacy-plan holder.

4. **Annual Continue is for a real change.** Hide Continue when the user
   is already on the selected tier's annual price. Show it when they
   pick a *different* tier (e.g. annual Plus → Max) or a
   monthly→annual switch on the same tier. Do not restore the old
   `!isOnAnnualPlan` hide — that blocked Plus→Unlimited for annual
   subscribers.

## Where the code lives

- Catalog filter: `backend/utils/subscription.py` → `filter_plans_for_user`
- Per-platform hidden set (catalog-storefront-driven): `backend/utils/subscription.py` → `_platform_hidden_plans`
- Upgrade guard: `backend/utils/subscription.py` → `desktop_to_consumer_plan_change_error`
- Continue button: `app/lib/utils/plan_pricing.dart` → `shouldShowPlanContinueButton` — **not yet updated for
  full unification** (Stage 1 mobile client lane, not dispatched as of this rewrite); its existing
  `app/test/utils/plan_pricing_test.dart` still encodes the old "desktop plan Continue onto a mobile tier
  is manage-only" assumption verbatim and will need the same rule-3-vs-rule-2 rework this file just got.
