import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { OMI_PLAN_PRODUCTS } from '@/lib/stripe-subscriptions';

/**
 * `OMI_PLAN_PRODUCTS` is a hand-maintained mirror of
 * `backend/config/plan_catalog.json`'s `recognized_stripe_products` ledger (the actual identity
 * source of truth) because this Next.js app has no build-time or runtime path to the backend's
 * Python catalog. This test reads the real catalog file at test time — the same file the backend
 * compiles from — so a plan launch or retirement that updates one side without the other fails
 * here instead of silently under- or over-counting subscriptions in the revenue dashboards.
 */
interface RecognizedStripeProduct {
  product_id: string;
  plan_id: string;
}

function readCatalogProductIds(): string[] {
  const catalogPath = join(__dirname, '../../../../backend/config/plan_catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as {
    recognized_stripe_products: RecognizedStripeProduct[];
  };
  return catalog.recognized_stripe_products.map((entry) => entry.product_id);
}

describe('OMI_PLAN_PRODUCTS vs backend/config/plan_catalog.json', () => {
  it('names every Stripe product id the catalog recognizes, and no others', () => {
    const catalogProductIds = new Set(readCatalogProductIds());
    const adminProductIds = new Set(Object.keys(OMI_PLAN_PRODUCTS));

    const missingFromAdmin = Array.from(catalogProductIds).filter((id) => !adminProductIds.has(id));
    const extraInAdmin = Array.from(adminProductIds).filter((id) => !catalogProductIds.has(id));

    expect(missingFromAdmin, 'catalog product IDs missing from OMI_PLAN_PRODUCTS').toEqual([]);
    expect(extraInAdmin, 'OMI_PLAN_PRODUCTS product IDs the catalog no longer recognizes').toEqual([]);
  });
});
