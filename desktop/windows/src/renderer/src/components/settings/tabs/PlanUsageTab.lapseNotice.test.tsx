// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import { SettingsSearchProvider } from '../SettingsSearchProvider'
import type { UserSubscriptionResponse, SubscriptionLapse } from '../../../lib/omiApi.generated'

// The main Plan & Usage card must surface the backend's `lapse` field directly
// (product decision, not optional — see resolve_subscription_lapse in
// backend/utils/subscription.py). These tests cover the three lapse-notice
// scenarios: cancellation_scheduled (keep-subscription), access_ended
// (resubscribe, neutral copy — the backend's `reason` is always `unknown` for
// this state), and null (no notice at all).

const fetchSubscription = vi.fn()
const fetchChatQuota = vi.fn()
const fetchTrial = vi.fn()
const fetchOverageInfo = vi.fn()

vi.mock('../../../lib/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/billing')>()
  return {
    ...actual,
    fetchSubscription: (...a: unknown[]) => fetchSubscription(...a),
    fetchChatQuota: (...a: unknown[]) => fetchChatQuota(...a),
    fetchTrial: (...a: unknown[]) => fetchTrial(...a),
    fetchOverageInfo: (...a: unknown[]) => fetchOverageInfo(...a)
  }
})
vi.mock('../../../lib/toast', () => ({ toast: vi.fn() }))

function makeSubResponse(lapse: SubscriptionLapse | null): UserSubscriptionResponse {
  const active = lapse === null || lapse.state === 'cancellation_scheduled'
  return {
    subscription: {
      plan: active ? 'operator' : 'basic',
      status: active ? 'active' : 'inactive',
      cancel_at_period_end: lapse?.state === 'cancellation_scheduled',
      current_price_id: active ? 'price_op_m' : undefined,
      current_period_end:
        lapse?.state === 'cancellation_scheduled'
          ? Math.floor(Date.now() / 1000) + 86_400
          : undefined
    },
    available_plans: [],
    insights_gained_limit: 0,
    insights_gained_used: 0,
    show_subscription_ui: true,
    lapse
  } as unknown as UserSubscriptionResponse
}

beforeEach(() => {
  fetchSubscription.mockReset()
  fetchChatQuota.mockReset().mockResolvedValue(null)
  fetchTrial.mockReset().mockResolvedValue(null)
  fetchOverageInfo.mockReset().mockResolvedValue(null)
  ;(window as unknown as { omi: unknown }).omi = {}
})

afterEach(cleanup)

async function renderTab(): Promise<void> {
  const { PlanUsageTab } = await import('./PlanUsageTab')
  render(
    <SettingsSearchProvider>
      <PlanUsageTab />
    </SettingsSearchProvider>
  )
}

describe('PlanUsageTab — subscription lapse notice', () => {
  it('cancellation_scheduled renders the keep-subscription notice', async () => {
    fetchSubscription.mockResolvedValue(
      makeSubResponse({
        state: 'cancellation_scheduled',
        reason: 'user_requested',
        recovery_action: 'keep_subscription',
        effective_at: Math.floor(Date.now() / 1000) + 86_400
      })
    )
    await renderTab()

    await waitFor(() =>
      expect(screen.queryByText(/You'll keep full access until then\./)).not.toBeNull()
    )
    expect(screen.getByRole('button', { name: 'Keep My Plan' })).not.toBeNull()
  })

  it('access_ended renders the resubscribe notice with neutral copy', async () => {
    fetchSubscription.mockResolvedValue(
      makeSubResponse({
        state: 'access_ended',
        reason: 'unknown',
        recovery_action: 'resubscribe',
        effective_at: null
      })
    )
    await renderTab()

    await waitFor(() => expect(screen.queryByText('Your paid access has ended.')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Resubscribe' })).not.toBeNull()

    const body = (document.body.textContent ?? '').toLowerCase()
    expect(body).not.toContain('cancel')
    expect(body).not.toContain('payment failed')
    expect(body).not.toContain('expired')
  })

  it('renders neither notice for a null lapse (Free, active-paid, or unknown-plan sentinel)', async () => {
    fetchSubscription.mockResolvedValue(makeSubResponse(null))
    await renderTab()

    await waitFor(() => expect(fetchSubscription).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Keep My Plan/)).toBeNull()
    expect(screen.queryByText(/Resubscribe/)).toBeNull()
    expect(screen.queryByText('Your paid access has ended.')).toBeNull()
  })
})
