// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LEGACY_SUPPORTER_NOTE } from '../lib/billing'
import type { SubscriptionPlan, UserSubscriptionResponse } from '../lib/omiApi.generated'

// Settings keeps every tab mounted (search). The other panels pull capture
// status, agents, Rewind, and the Memories WebGL map — none of that is this
// test. Stub them so we exercise the real rail + PlanUsageTab + CurrentPlanCard.
vi.mock('../components/settings/tabs/GeneralTab', () => ({ GeneralTab: () => null }))
vi.mock('../components/settings/tabs/RewindTab', () => ({ RewindTab: () => null }))
vi.mock('../components/settings/tabs/NotificationsTab', () => ({ NotificationsTab: () => null }))
vi.mock('../components/settings/tabs/PrivacyTab', () => ({ PrivacyTab: () => null }))
vi.mock('../components/settings/tabs/AccountTab', () => ({ AccountTab: () => null }))
vi.mock('../components/settings/tabs/AdvancedTab', () => ({ AdvancedTab: () => null }))
vi.mock('../components/settings/tabs/AgentsTab', () => ({ AgentsTab: () => null }))
vi.mock('../components/settings/tabs/TranscriptionTab', () => ({ TranscriptionTab: () => null }))
vi.mock('../components/settings/tabs/ShortcutsTab', () => ({ ShortcutsTab: () => null }))
vi.mock('../components/settings/tabs/AboutTab', () => ({ AboutTab: () => null }))
vi.mock('./Memories', () => ({ Memories: () => null }))

const getMock = vi.fn()
vi.mock('../lib/apiClient', () => ({
  omiApi: { get: (...args: unknown[]) => getMock(...args), post: vi.fn() }
}))
vi.mock('../lib/toast', () => ({ toast: vi.fn() }))

const CATALOG: SubscriptionPlan[] = [
  {
    id: 'plus',
    title: 'Plus',
    description: '200 chat questions per month.',
    prices: [{ id: 'price_plus_m', title: 'Monthly', price_string: '$19/mo' }]
  },
  {
    id: 'pro_v2',
    title: 'Pro',
    description: '1,000 chat questions per month.',
    prices: [{ id: 'price_pro_m', title: 'Monthly', price_string: '$29/mo' }]
  },
  {
    id: 'unlimited_v2',
    title: 'Unlimited',
    legacy: true,
    description: 'Unlimited transcription — record all day.',
    prices: [{ id: 'price_uv2_m', title: 'Monthly', price_string: '$19/mo' }]
  },
  {
    id: 'unlimited',
    title: 'Neo',
    legacy: true,
    description: 'Unlimited transcription and chat.',
    prices: [{ id: 'price_neo_m', title: 'Monthly', price_string: '$14/mo' }]
  }
]

function subscriptionResponse(
  plan: string,
  currentPriceId: string | null
): UserSubscriptionResponse {
  return {
    insights_gained_limit: 0,
    insights_gained_used: 0,
    transcription_seconds_limit: 0,
    transcription_seconds_used: 0,
    words_transcribed_limit: 0,
    words_transcribed_used: 0,
    show_subscription_ui: false,
    available_plans: CATALOG,
    subscription: {
      plan: plan as UserSubscriptionResponse['subscription']['plan'],
      status: 'active',
      current_price_id: currentPriceId
    }
  }
}

function stubGets(body: UserSubscriptionResponse): void {
  getMock.mockImplementation((url: string) => {
    if (url === '/v1/users/me/subscription') return Promise.resolve({ data: body })
    if (
      url === '/v1/users/me/usage-quota' ||
      url === '/v1/users/me/trial' ||
      url === '/v1/payments/overage-info'
    ) {
      return Promise.resolve({ data: null })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

async function renderSettings(): Promise<void> {
  const { Settings } = await import('./Settings')
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/home" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>
  )
}

async function openPlanUsage(): Promise<HTMLElement> {
  await renderSettings()
  fireEvent.click(screen.getByRole('button', { name: 'Plan & Usage' }))
  const heading = await screen.findByRole('heading', { name: 'Plan & Usage' })
  const section = heading.closest('section')
  if (!section) throw new Error('Plan & Usage panel is missing')
  expect(section.className).not.toContain('hidden')
  return section
}

beforeEach(() => {
  getMock.mockReset()
  ;(window as unknown as { omi: unknown }).omi = {}
})

afterEach(() => {
  cleanup()
  vi.resetModules()
})

describe('Settings — Plan & Usage current-plan card', () => {
  it('opens Plan & Usage from the Settings rail and shows the current plan', async () => {
    stubGets(subscriptionResponse('unlimited', 'price_plus_m'))
    await renderSettings()

    const heading = screen.getByRole('heading', { name: 'Plan & Usage' })
    expect(heading.closest('section')?.className).toContain('hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Plan & Usage' }))
    await waitFor(() => {
      expect(heading.closest('section')?.className).not.toContain('hidden')
    })
    expect(screen.getByText('Plus')).not.toBeNull()
    expect(screen.queryByText('You are currently on the free tier.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage' })).not.toBeNull()
  })

  it('recovers Unlimited-v2 from a remapped plan=unlimited wire and does not fall through to Free', async () => {
    stubGets(subscriptionResponse('unlimited', 'price_uv2_m'))
    const panel = await openPlanUsage()

    expect(panel.textContent).toContain('Unlimited (Legacy Plan)')
    expect(panel.textContent).toContain(LEGACY_SUPPORTER_NOTE)
    expect(panel.textContent).not.toContain('You are currently on the free tier.')
    expect(screen.queryByText('Free')).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage' })).not.toBeNull()
  })

  it('shows Plus without a Legacy suffix when the price belongs to Plus', async () => {
    stubGets(subscriptionResponse('unlimited', 'price_plus_m'))
    const panel = await openPlanUsage()

    expect(panel.textContent).toContain('Plus')
    expect(panel.textContent).not.toContain('(Legacy Plan)')
    expect(panel.textContent).toContain('Plus Monthly • $19/mo')
    expect(screen.getByRole('button', { name: 'Manage' })).not.toBeNull()
  })

  it('shows Free with the free-tier subtitle and a Refresh action', async () => {
    stubGets(subscriptionResponse('basic', null))
    const panel = await openPlanUsage()

    expect(screen.getByText('Free')).not.toBeNull()
    expect(panel.textContent).toContain('You are currently on the free tier.')
    expect(panel.textContent).not.toContain('(Legacy Plan)')
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeNull()
  })
})
