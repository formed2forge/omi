import { describe, expect, it } from 'vitest';

import {
  CORE_TIER_TRANSCRIPTION_MINUTES_LIMIT,
  CORE_TIER_TRANSCRIPTION_SECONDS_LIMIT,
} from '@/lib/basicPlanLimits';

describe('Core plan transcription limit', () => {
  // Regression: SettingsPage previously hardcoded "1,200 minutes" (72,000s) at three call
  // sites. The deployed backend has enforced 300 min/month (18,000s) since
  // `BASIC_TIER_MINUTES_LIMIT_PER_MONTH=300` shipped
  // (backend/charts/{backend-listen,pusher}/prod_omi_*_values.yaml), matching the canonical
  // `basic` plan's `transcription` allocation in backend/config/plan_catalog.json — so the
  // frontend was showing 4x the real free-tier allowance.
  it('matches the deployed Core catalog allocation', () => {
    expect(CORE_TIER_TRANSCRIPTION_MINUTES_LIMIT).toBe(300);
  });

  it('derives the seconds limit from the single minutes constant', () => {
    expect(CORE_TIER_TRANSCRIPTION_SECONDS_LIMIT).toBe(
      CORE_TIER_TRANSCRIPTION_MINUTES_LIMIT * 60,
    );
  });
});
