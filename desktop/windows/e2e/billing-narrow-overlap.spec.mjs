/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain-JS test harness */
// Regression E2E for the narrow-window BillingCard overlap defect: drives the
// REAL built app (out/main/index.js) via Playwright's _electron, resizes the
// actual Electron BrowserWindow to the reported repro size (520x700, still
// above the 500x600 floor — src/main/index.ts minWidth/minHeight), and
// measures REAL bounding boxes of the title/subtitle text vs. the trailing
// action button. This is real-Chromium layout (Electron's renderer is
// Chromium), not jsdom — jsdom never computes layout, so a class-presence
// assertion there cannot prove or disprove a geometric overlap.
//
// Hermetic: OMI_E2E_FAKE_AUTH boots an offline authed shell (no network); the
// four billing GET endpoints are intercepted via page.route with fixture
// JSON per scenario so no live backend is required. Each launch gets its own
// throwaway --user-data-dir. Screenshots land in .playwright-mcp/ for the
// skeptical reviewer.
//
// Run after a build: node --test e2e/billing-narrow-overlap.spec.mjs
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out', 'main', 'index.js')
const shotsDir = path.join(root, '.playwright-mcp')

const baseEnv = {
  ...process.env,
  OMI_E2E: '1',
  OMI_E2E_FAKE_AUTH: '1',
  OMI_AUTOMATION: '0',
  OMI_SKIP_TUNNEL: '1'
}

const SECONDARY_HASHES = ['#/bar', '#/insight-toast', '#/capture']
const isSecondary = (u) => SECONDARY_HASHES.some((h) => u.includes(h))

async function launch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'omi-billing-e2e-'))
  // --hidden (src/main/index.ts) skips mainWindow.show() entirely — the renderer
  // still composites and Playwright's CDP-based page.screenshot()/boundingBox()
  // work against it, but no OS-level window ever appears on the user's screen
  // (no focus stealing, nothing to reposition off the external display).
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${dir}`, '--hidden'],
    env: baseEnv
  })
  const cleanup = async () => {
    try {
      await app.close()
    } catch {
      /* already closed */
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
  return { app, cleanup }
}

async function mainPage(app) {
  await app.firstWindow()
  for (let i = 0; i < 100; i++) {
    const page = (await app.windows()).find((w) => !isSecondary(w.url()))
    if (page) {
      const ready = await page
        .evaluate(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0)
        .catch(() => false)
      if (ready) return page
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('main-window shell never mounted')
}

const json = (route, body) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body)
  })

/** Route the four billing GETs (see src/renderer/src/lib/billing.ts) to fixture
 *  JSON. `omiApi` is an axios client hitting a configured base URL + these
 *  paths, so a suffix match on the pathname is host-agnostic. Mirrors the
 *  stub-then-override precedence in e2e/conversation-detail.spec.mjs: a
 *  catch-all `**\/v1/**` abort registered FIRST (lowest precedence) so any
 *  call this fixture doesn't know about fails loudly instead of leaking to a
 *  live backend, then the specific routes registered after it win. */
async function mockBilling(page, { sub, quota = null, trial = null, overage = null }) {
  await page.route('**/v1/**', (route) => route.abort())
  await page.route('**/v1/users/me/subscription*', (route) => json(route, sub))
  await page.route('**/v1/users/me/usage-quota*', (route) => json(route, quota))
  await page.route('**/v1/users/me/trial*', (route) => json(route, trial))
  await page.route('**/v1/payments/overage-info*', (route) => json(route, overage))
}

async function openPlanUsage(page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  const rail = page.getByRole('button', { name: 'Plan & Usage', exact: true })
  await rail.waitFor({ state: 'visible', timeout: 20000 })
  await rail.click()
  await page.getByRole('heading', { level: 1, name: 'Plan & Usage' }).waitFor({
    state: 'visible',
    timeout: 20000
  })
  await new Promise((r) => setTimeout(r, 300))
}

// Several other BrowserWindows exist alongside the main window (bar, glow,
// insight-toast, capture) — some report an empty webContents URL, so filtering
// OUT '#/bar' etc. is not enough to pick the right one (confirmed by manual
// probe: it grabbed one of the offscreen helper windows instead of the main
// window, and the resize silently applied to the wrong BrowserWindow). Match
// by the EXACT url of the already-identified main-window Page instead.
async function resizeWindow(app, page, width, height) {
  const url = page.url()
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === args.url)
      if (!win) throw new Error(`no window matching url ${args.url} to resize`)
      win.setBounds({ width: args.width, height: args.height })
    },
    { url, width, height }
  )
  // Let the renderer's resize observers / reflow settle.
  await new Promise((r) => setTimeout(r, 250))
}

/** True if two DOMRect-like boxes overlap (share any area). */
function rectsOverlap(a, b) {
  if (!a || !b) return false
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shapes mirror PlanUsageTab.lapseNotice.test.tsx's makeSubResponse and the
// resolvePlanTitle/currentPlanSubtitle/isKeepUntilCancelPlan rules in
// src/renderer/src/lib/billing.ts + billingPlans.ts.

const PLUS_CATALOG = [
  {
    id: 'plus',
    title: 'Plus',
    prices: [{ id: 'price_plus_m', title: 'Monthly', price_string: '$9.99/month' }]
  }
]

const UNLIMITED_LEGACY_CATALOG = [
  {
    id: 'unlimited_v2',
    title: 'Unlimited',
    legacy: true,
    prices: [{ id: 'price_unl_m', title: 'Monthly (Legacy pricing)', price_string: '$16.99/month' }]
  }
]

function fixturePlus() {
  return {
    sub: {
      subscription: {
        plan: 'plus',
        status: 'active',
        cancel_at_period_end: false,
        current_price_id: 'price_plus_m',
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400
      },
      available_plans: PLUS_CATALOG,
      insights_gained_limit: 0,
      insights_gained_used: 0,
      show_subscription_ui: true,
      lapse: null
    }
  }
}

function fixtureUnlimitedLegacy() {
  return {
    sub: {
      subscription: {
        plan: 'unlimited_v2',
        status: 'active',
        cancel_at_period_end: false,
        current_price_id: 'price_unl_m',
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400
      },
      available_plans: UNLIMITED_LEGACY_CATALOG,
      insights_gained_limit: 0,
      insights_gained_used: 0,
      show_subscription_ui: true,
      lapse: null
    }
  }
}

function fixtureCancellationScheduled() {
  return {
    sub: {
      subscription: {
        plan: 'operator',
        status: 'active',
        cancel_at_period_end: true,
        current_price_id: 'price_op_m',
        current_period_end: Math.floor(Date.now() / 1000) + 86_400
      },
      available_plans: [],
      insights_gained_limit: 0,
      insights_gained_used: 0,
      show_subscription_ui: true,
      lapse: {
        state: 'cancellation_scheduled',
        reason: 'user_requested',
        recovery_action: 'keep_subscription',
        effective_at: Math.floor(Date.now() / 1000) + 86_400
      }
    }
  }
}

function fixtureAccessEndedLapsedFree() {
  return {
    sub: {
      subscription: {
        plan: 'basic',
        status: 'inactive',
        cancel_at_period_end: false
      },
      available_plans: [],
      insights_gained_limit: 0,
      insights_gained_used: 0,
      show_subscription_ui: true,
      lapse: {
        state: 'access_ended',
        reason: 'unknown',
        recovery_action: 'resubscribe',
        effective_at: null
      }
    }
  }
}

function fixtureUnknownPlan() {
  return {
    sub: {
      subscription: {
        // Not in CATALOG_PLAN_IDS / LEGACY_PLAN_ALIASES — canonicalPlanId()
        // returns undefined, exercising the "Plan unavailable" sentinel.
        plan: 'mystery_plan_2027',
        status: 'active'
      },
      available_plans: [],
      insights_gained_limit: 0,
      insights_gained_used: 0,
      show_subscription_ui: true,
      lapse: null
    }
  }
}

const SCENARIOS = [
  { name: 'plus-paid-manage', fixture: fixturePlus, button: 'Manage' },
  { name: 'unlimited-legacy-manage', fixture: fixtureUnlimitedLegacy, button: 'Manage' },
  {
    name: 'cancellation-scheduled-keep-my-plan',
    fixture: fixtureCancellationScheduled,
    button: 'Keep My Plan'
  },
  { name: 'access-ended-lapsed-free-resubscribe', fixture: fixtureAccessEndedLapsedFree, button: 'Resubscribe' },
  { name: 'unknown-plan-refresh', fixture: fixtureUnknownPlan, button: 'Refresh' }
]

const SIZES = [
  { name: '520x700-repro', width: 520, height: 700 },
  { name: '500x600-floor', width: 500, height: 600 },
  { name: '1280x820-default', width: 1280, height: 820 }
]

/** Locate the card + title + button for a scenario's button label, capture a
 *  screenshot, and assert (a) no title/button overlap and (b) the button
 *  stays inside the card's own width (a pure "shrink text harder" fix could
 *  avoid (a) while still overflowing/clipping — this catches that). */
async function assertNoOverlap(page, scenario, tag) {
  const actionButton = page.getByRole('button', { name: scenario.button, exact: true }).first()
  await actionButton.waitFor({ state: 'visible', timeout: 20000 })

  // The card whose header row contains this button — walk up from the button
  // to the flex row (`.flex.items-start`), then find the title element
  // (`.text-\\[15px\\].font-semibold`) as a sibling.
  const card = page.locator('.surface-card', { has: actionButton })
  const titleEl = card.locator('.text-\\[15px\\].font-semibold').first()
  await titleEl.waitFor({ state: 'visible', timeout: 20000 })

  const titleBox = await titleEl.boundingBox()
  const buttonBox = await actionButton.boundingBox()

  mkdirSync(shotsDir, { recursive: true })
  // Generous timeout: page.screenshot() waits on document.fonts.ready, which
  // can exceed the 30s default under heavy machine load (many sequential
  // Electron launches in this suite) — not a product issue.
  await page.screenshot({ path: path.join(shotsDir, `billing-overlap-${tag}.png`), timeout: 60000 })

  assert.ok(titleBox, `title element has a bounding box (${tag})`)
  assert.ok(buttonBox, `action button has a bounding box (${tag})`)
  assert.equal(
    rectsOverlap(titleBox, buttonBox),
    false,
    `title "${JSON.stringify(titleBox)}" overlaps action button "${JSON.stringify(buttonBox)}" (${tag})`
  )

  const cardBox = await card.boundingBox()
  assert.ok(cardBox, `card has a bounding box (${tag})`)
  assert.ok(
    buttonBox.x + buttonBox.width <= cardBox.x + cardBox.width + 0.5,
    `action button (${JSON.stringify(buttonBox)}) overflows its card (${JSON.stringify(cardBox)}) (${tag})`
  )
}

describe('BillingCard — narrow-window title/action overlap regression', () => {
  for (const scenario of SCENARIOS) {
    for (const size of SIZES) {
      const tag = `${scenario.name}-${size.name}`
      test(`${scenario.name} @ ${size.name}: title/subtitle never overlaps the action button`, async (t) => {
        const { app, cleanup } = await launch()
        t.after(cleanup)
        const page = await mainPage(app)

        await mockBilling(page, scenario.fixture())
        await resizeWindow(app, page, size.width, size.height)
        await openPlanUsage(page)
        await assertNoOverlap(page, scenario, tag)
      })
    }
  }
})

// NOTE on OS-level text scale: an attempted "at 520x700 + larger text scale"
// case was investigated (Ctrl+= up to FONT_SCALE_MAX=2.0 — src/renderer/src/
// lib/fontScale.ts) but dropped from this suite. Diagnosis (manual probe):
// even at ~130% scale — the ceiling e2e/font-size.spec.mjs itself vouches for
// ("confirm nothing clips/overflows/wraps at ~130%") — the FIXED-WIDTH
// SettingsTabRail alone consumes nearly the entire 520px window, collapsing
// the whole content column (every settings tab, not just Plan & Usage) to a
// sliver a few px wide. That is a pre-existing Settings-shell layout gap
// (SettingsTabRail.tsx / Settings.tsx not reflowing under a narrow-window +
// large-text combination), independent of and outside BillingCard.tsx's
// title/action row — fixing it would mean redesigning the rail's responsive
// behavior for every tab, a materially different and much larger change than
// this defect. Filed as a follow-up rather than folded into this fix.
