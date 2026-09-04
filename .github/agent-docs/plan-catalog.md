# Plan catalog audience

Canonical identity, billed price identity, entitlements, allocations, and migration ownership are in
`backend/config/plan_catalog.json` and `.github/agent-docs/plan-source-of-truth.md`. This page owns only storefront audience
behavior. Do not add plan values or Stripe IDs here.

Locked purchase-catalog rules. Tests in
`backend/tests/unit/test_subscription_restructure.py` and
`app/test/utils/plan_pricing_test.dart` enforce them. Do not re-widen a
filter because a paid user "might want to resubscribe" or because the
phone sheet looks empty.

## Storefronts

| Surface | Sells | Does not sell |
|---|---|---|
| Mobile (`ios` / `android`) | Plus + Pro (`pro_v2`) | Operator, Architect, Neo, Unlimited-v2 |
| Desktop (`macos` / `windows`) | Plus + Pro (`pro_v2`) | Operator, Architect, Neo, Unlimited-v2 |
| Web | Plus + Pro (`pro_v2`) | Operator, Architect, Neo, Unlimited-v2 |

Every surface sells the same new-buyer ladder: Free (not a paid SKU), Plus, and Pro. `pro` on the wire is still Architect — Pro's plan id is `pro_v2`. Do not add a plan whose id is `pro`.

Neo (`PlanType.unlimited`), Unlimited-v2, Operator, and Architect are keep-until-cancel. They are never a new-user SKU on any real client platform. A current subscriber still sees their own plan so they can manage or cancel.

## Audience rules

1. **Deprecated plans are current-subscriber only.** Show Neo iff `current_plan == unlimited`
   (active or cancel-at-period-end). Same shape for Unlimited-v2, Operator, and
   Architect. Do **not** key it off "has ever paid" / Stripe customer id. That
   leak put Neo on Architect and Plus sheets, where Plus looked strictly cheaper
   because Neo's simplified mobile card omits unlimited transcription.
   Fully churned ex-Neo users are `basic` and get Plus + Pro, the replacement
   catalog. Do not bring Neo or Unlimited-v2 back for them.

2. **Desktop-only plans are manage-only on mobile.** An Operator or Architect
   subscriber opening iOS/Android sees **only** their current plan
   (Active, cancel, portal). They cannot Continue onto Plus / Pro / Neo.
   Immediate Stripe proration would strip desktop entitlement.
   Plus and Pro are desktop-entitled *and* sold on mobile, so this lock does
   not apply to them. Operator ↔ Architect stays allowed where both are visible
   (current subscribers on desktop/web).
   The upgrade API (`desktop_to_consumer_plan_change_error`) is the
   same boundary: confirmation in the app is not an exception.

3. **Annual Continue is for a real change.** Hide Continue when the user
   is already on the selected tier's annual price. Show it when they
   pick a *different* tier (e.g. annual Plus → Pro) or a
   monthly→annual switch on the same tier. Do not restore the old
   `!isOnAnnualPlan` hide — that blocked Plus→Unlimited for annual
   subscribers.

## Where the code lives

- Catalog filter: `backend/utils/subscription.py` → `filter_plans_for_user` (hidden set is derived from `PLAN_STOREFRONTS`)
- Upgrade guard: `backend/utils/subscription.py` → `desktop_to_consumer_plan_change_error`
- Continue button: `app/lib/utils/plan_pricing.dart` → `shouldShowPlanContinueButton`
