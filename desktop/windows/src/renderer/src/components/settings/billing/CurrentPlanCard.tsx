import { CreditCard, Loader2, RefreshCw } from 'lucide-react'
import { BillingCard } from './BillingCard'
import {
  resolvePlanTitle,
  currentPlanSubtitle,
  currentPlanPeriodText,
  currentPlanDescription,
  currentPlanFeatures,
  hasPaidSubscription,
  isKeepUntilCancelPlan,
  LEGACY_SUPPORTER_NOTE
} from '../../../lib/billing'
import type { UserSubscriptionResponse } from '../../../lib/omiApi.generated'

/**
 * Current-plan card (AccountBilling "planusage.current"): plan title + billing
 * detail, a description of what the plan includes, a renew/access-ends caption,
 * and a Manage (paid → Stripe portal) or Refresh (free) action.
 */
export function CurrentPlanCard(props: {
  sub: UserSubscriptionResponse
  portalBusy: boolean
  refreshing: boolean
  onManage: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const { sub, portalBusy, refreshing, onManage, onRefresh } = props
  const subscription = sub.subscription
  const paid = hasPaidSubscription(subscription)
  const periodText = currentPlanPeriodText(subscription)
  const description = currentPlanDescription(subscription, sub.available_plans)
  const features = currentPlanFeatures(subscription, sub.available_plans)
  const keepUntilCancel = isKeepUntilCancelPlan(subscription, sub.available_plans)

  return (
    <BillingCard
      icon={CreditCard}
      title={resolvePlanTitle(subscription, sub.available_plans)}
      subtitle={currentPlanSubtitle(subscription, sub.available_plans)}
      trailing={
        paid ? (
          <button
            onClick={onManage}
            disabled={portalBusy}
            className="btn-ghost disabled:opacity-50"
          >
            {portalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Manage
          </button>
        ) : (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-ghost disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )
      }
    >
      {description ? <div className="text-sm text-text-tertiary">{description}</div> : null}
      {features.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm text-text-tertiary">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      ) : null}
      {keepUntilCancel ? (
        <div className="mt-3 text-sm text-text-tertiary">{LEGACY_SUPPORTER_NOTE}</div>
      ) : null}
      {periodText ? <div className="mt-3 text-sm text-text-tertiary">{periodText}</div> : null}
    </BillingCard>
  )
}
