import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UsageSectionContent } from '@/components/settings/SettingsPage';
import type { UserSubscription, SubscriptionLapse } from '@/types/user';

// UsageSectionContent's action handlers call into '@/lib/api' (checkout
// session / upgrade / cancel / customer portal). Mocking the module keeps
// this a component test of the render + wiring decision, not an HTTP test.
vi.mock('@/lib/api', () => ({
  createCheckoutSession: vi.fn().mockResolvedValue({ status: 'reactivated' }),
  upgradeSubscription: vi.fn().mockResolvedValue({ status: 'success' }),
  cancelSubscription: vi.fn().mockResolvedValue({ status: 'success' }),
  getCustomerPortal: vi.fn().mockResolvedValue({ url: 'https://billing.example/portal' }),
}));

import { createCheckoutSession } from '@/lib/api';

function subscription(overrides: Partial<UserSubscription> = {}): UserSubscription {
  return {
    plan: 'unlimited_v2',
    plan_identity: { kind: 'known', id: 'unlimited_v2', raw: 'unlimited_v2' },
    status: 'active',
    is_unlimited: true,
    current_period_end: 1_760_000_000,
    stripe_subscription_id: 'sub_123',
    cancel_at_period_end: false,
    current_price_id: 'price_123',
    features: [],
    lapse: null,
    ...overrides,
  };
}

function renderPlanUsage(sub: UserSubscription | null) {
  const onSubscriptionUpdate = vi.fn();
  render(
    <UsageSectionContent
      allUsage={null}
      subscription={sub}
      onSubscriptionUpdate={onSubscriptionUpdate}
      cachedPlans={[
        {
          id: 'price_123',
          title: 'Unlimited Monthly',
          price_string: '$9.99/mo',
          is_active: true,
        },
      ]}
    />,
  );
  return { onSubscriptionUpdate, user: userEvent.setup() };
}

const cancellationScheduledLapse: SubscriptionLapse = {
  state: 'cancellation_scheduled',
  reason: 'user_requested',
  recovery_action: 'keep_subscription',
  effective_at: 1_760_000_000, // 2025-10-09
};

const accessEndedLapse: SubscriptionLapse = {
  state: 'access_ended',
  reason: 'unknown',
  recovery_action: 'resubscribe',
  effective_at: 1_758_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Plan & Usage card — lapse notice', () => {
  it('renders the keep-subscription notice for cancellation_scheduled', () => {
    renderPlanUsage(
      subscription({ lapse: cancellationScheduledLapse, cancel_at_period_end: true }),
    );

    expect(screen.getByText(/Your plan will end on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep My Plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resubscribe' })).not.toBeInTheDocument();
  });

  it('renders the resubscribe notice with neutral copy for access_ended', () => {
    renderPlanUsage(
      subscription({
        plan: 'basic',
        plan_identity: { kind: 'known', id: 'basic', raw: 'basic' },
        is_unlimited: false,
        lapse: accessEndedLapse,
      }),
    );

    const notice = screen.getByText('Your paid access has ended.');
    expect(notice).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resubscribe' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Keep My Plan' }),
    ).not.toBeInTheDocument();

    // Neutral copy: never guesses a specific cause.
    const bodyText = notice.textContent ?? '';
    expect(bodyText.toLowerCase()).not.toContain('cancel');
    expect(bodyText.toLowerCase()).not.toContain('payment failed');
    expect(bodyText.toLowerCase()).not.toContain('expired');
  });

  it('renders neither notice for a null lapse (Free, active-paid, or the unknown-plan sentinel)', () => {
    renderPlanUsage(subscription({ lapse: null }));
    expect(
      screen.queryByRole('button', { name: 'Keep My Plan' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resubscribe' })).not.toBeInTheDocument();

    renderPlanUsage(
      subscription({
        plan: 'basic',
        plan_identity: { kind: 'known', id: 'basic', raw: 'basic' },
        is_unlimited: false,
        lapse: null,
      }),
    );
    expect(
      screen.queryByRole('button', { name: 'Keep My Plan' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resubscribe' })).not.toBeInTheDocument();

    // Unknown-plan sentinel: lapse is null whenever it's active, so this must
    // render the (pre-existing) UnknownPlanCard's own copy, not either notice.
    renderPlanUsage(
      subscription({
        plan: 'some_future_plan_id',
        plan_identity: { kind: 'unknown', raw: 'some_future_plan_id' },
        is_unlimited: false,
        lapse: null,
      }),
    );
    expect(screen.getByText('Plan unavailable')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Keep My Plan' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resubscribe' })).not.toBeInTheDocument();
  });

  it('wires "Keep My Plan" to the same reactivation call the migrated Reactivate Subscription button uses', async () => {
    const { onSubscriptionUpdate, user } = renderPlanUsage(
      subscription({ lapse: cancellationScheduledLapse, cancel_at_period_end: true }),
    );

    // The re-keyed isCancelingSubscription (off lapse.state, not a separate
    // cancel_at_period_end read) should also be driving the existing
    // "Reactivate Subscription" primary button in the Unlimited plan view.
    expect(
      screen.getByRole('button', { name: 'Reactivate Subscription' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep My Plan' }));

    expect(createCheckoutSession).toHaveBeenCalledWith('price_123');
    expect(onSubscriptionUpdate).toHaveBeenCalled();
  });
});
