import 'package:flutter_test/flutter_test.dart';

import 'package:omi/models/subscription.dart';
import 'package:omi/utils/subscription_plan_presentation.dart';

Subscription _sub({
  required String plan,
  String? currentPriceId,
  List<String> features = const [],
  String status = 'active',
}) {
  return Subscription.fromJson({
    'plan': plan,
    'status': status,
    'current_price_id': currentPriceId,
    'features': features,
    'cancel_at_period_end': false,
    'deprecated': false,
    'limits': <String, dynamic>{},
  });
}

SubscriptionPlan _plan({
  required String id,
  required String title,
  String? description,
  bool legacy = false,
  List<String> priceIds = const [],
  List<String> features = const [],
}) {
  return SubscriptionPlan(
    id: id,
    title: title,
    description: description,
    legacy: legacy,
    features: features,
    prices: [for (final priceId in priceIds) PricingOption(id: priceId, title: 'Monthly', priceString: '\$0')],
  );
}

final _newLadderCatalog = [
  _plan(
    id: 'plus',
    title: 'Plus',
    description: '200 chat questions per month. 1,500 minutes of transcription per month, then on-device.',
    priceIds: ['price_plus_m'],
  ),
  _plan(
    id: 'pro_v2',
    title: 'Pro',
    description: '1,000 chat questions per month. Full desktop, mobile, and web access.',
    priceIds: ['price_pro_m'],
  ),
];

final _keepUntilCancelCatalog = [
  _plan(id: 'unlimited', title: 'Neo', legacy: true, priceIds: ['price_neo_m']),
  _plan(id: 'operator', title: 'Operator', legacy: true, priceIds: ['price_op_m']),
  _plan(id: 'architect', title: 'Architect', legacy: true, priceIds: ['price_arch_m']),
  _plan(id: 'unlimited_v2', title: 'Unlimited', legacy: true, priceIds: ['price_uv2_m']),
];

void main() {
  group('planBadgeLabel — Settings drawer plan badge regression test', () {
    test('Plus account shows PLUS badge, not PRO', () {
      // Regression test for QA defect: pricing_plus showed PRO badge in Settings drawer
      // while correctly showing Plus in Plan & Usage detail screen.
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_plus_m'),
        catalog: _newLadderCatalog,
      );
      expect(badge, 'PLUS');
    });

    test('Pro account shows PRO badge', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'pro_v2', currentPriceId: 'price_pro_m'),
        catalog: _newLadderCatalog,
      );
      expect(badge, 'PRO');
    });

    test('Neo legacy account shows NEO badge', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_neo_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(badge, 'NEO');
    });

    test('Architect legacy account shows ARCHITECT badge', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_arch_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(badge, 'ARCHITECT');
    });

    test('Operator legacy account shows OPERATOR badge', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'operator', currentPriceId: 'price_op_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(badge, 'OPERATOR');
    });

    test('Unlimited-v2 legacy account shows UNLIMITED badge', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_uv2_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(badge, 'UNLIMITED');
    });

    test('BYOK account shows BYOK badge', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'basic', currentPriceId: null, features: ['byok']),
        catalog: _newLadderCatalog,
      );
      expect(badge, 'BYOK');
    });

    test('Free account shows FREE badge when paid=false', () {
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'basic', currentPriceId: null),
        catalog: _newLadderCatalog,
      );
      expect(badge, 'FREE');
    });

    test('Unknown plan fallback uses plan id, uppercased', () {
      // Future-proofing: if a new plan comes from the backend before client update,
      // render the plan id as the badge rather than silently showing wrong plan.
      final badge = planBadgeLabel(
        subscription: _sub(plan: 'future_plan_123', currentPriceId: null),
        catalog: _newLadderCatalog,
      );
      expect(badge, 'FUTURE_PLAN_123');
    });
  });
}
