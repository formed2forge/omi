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

final _keepUntilCancelCatalog = [
  _plan(id: 'unlimited', title: 'Neo', legacy: true, priceIds: ['price_neo_m']),
  _plan(id: 'operator', title: 'Operator', legacy: true, priceIds: ['price_op_m']),
  _plan(id: 'architect', title: 'Architect', legacy: true, priceIds: ['price_arch_m']),
  _plan(id: 'unlimited_v2', title: 'Unlimited', legacy: true, priceIds: ['price_uv2_m']),
];

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

void main() {
  group('owningCatalogPlan', () {
    test('recovers Plus from a price id even when the wire plan is unlimited', () {
      final owning = owningCatalogPlan(currentPriceId: 'price_plus_m', catalog: _newLadderCatalog);
      expect(owning?.id, 'plus');
      expect(owning?.title, 'Plus');
    });

    test('returns null when the price is missing from the catalog', () {
      expect(owningCatalogPlan(currentPriceId: 'unknown', catalog: _newLadderCatalog), isNull);
    });
  });

  group('isKeepUntilCancelPlan', () {
    test('labels Neo, Operator, Architect, and Unlimited-v2 as keep-until-cancel', () {
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.unlimited,
          features: const [],
          currentPriceId: 'price_neo_m',
          catalog: _keepUntilCancelCatalog,
        ),
        isTrue,
      );
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.operator,
          features: const [],
          currentPriceId: 'price_op_m',
          catalog: _keepUntilCancelCatalog,
        ),
        isTrue,
      );
    });

    test('does not label Plus or Pro as legacy', () {
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.plus,
          features: const [],
          currentPriceId: 'price_plus_m',
          catalog: _newLadderCatalog,
        ),
        isFalse,
      );
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.proV2,
          features: const [],
          currentPriceId: 'price_pro_m',
          catalog: _newLadderCatalog,
        ),
        isFalse,
      );
    });

    test('BYOK is never keep-until-cancel', () {
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.unlimited,
          features: const ['byok'],
          currentPriceId: 'price_neo_m',
          catalog: _keepUntilCancelCatalog,
        ),
        isFalse,
      );
    });

    test('falls back to the plan id when the catalog has no price match', () {
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.unlimited,
          features: const [],
          currentPriceId: 'legacy_price',
          catalog: _keepUntilCancelCatalog,
        ),
        isTrue,
      );
      expect(
        isKeepUntilCancelPlan(
          plan: PlanType.plus,
          features: const [],
          currentPriceId: 'legacy_price',
          catalog: _newLadderCatalog,
        ),
        isFalse,
      );
    });
  });

  group('currentPlanView', () {
    test('Plus recovered from price id is Plus with no Legacy suffix', () {
      // Wire trap: plus serializes as plan=unlimited. Testers must still see Plus.
      final view = currentPlanView(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_plus_m'),
        catalog: _newLadderCatalog,
      );
      expect(view.baseTitle, 'Plus');
      expect(view.isKeepUntilCancel, isFalse);
      expect(view.titled(legacySuffix: defaultLegacyPlanTitleSuffix), 'Plus');
      expect(view.description, contains('200 chat'));
    });

    test('Neo is Neo (Legacy Plan) with a non-empty description', () {
      final view = currentPlanView(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_neo_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(view.baseTitle, 'Neo');
      expect(view.isKeepUntilCancel, isTrue);
      expect(view.titled(legacySuffix: defaultLegacyPlanTitleSuffix), 'Neo (Legacy Plan)');
      expect(view.description, contains('200 chat'));
      expect(view.description.toLowerCase(), isNot(contains('100 chat')));
    });

    test('uses the fallback Neo description when the catalog omits copy', () {
      final view = currentPlanView(
        subscription: _sub(plan: 'unlimited', currentPriceId: 'price_neo_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(view.description, contains('Unlimited transcription'));
    });

    test('describes Free, Plus, and Pro so current plans can be compared', () {
      expect(
        currentPlanView(
          subscription: _sub(plan: 'basic'),
          catalog: const [],
        ).description,
        contains('30 chat'),
      );
      expect(
        currentPlanView(
          subscription: _sub(plan: 'plus', currentPriceId: 'price_plus_m'),
          catalog: _newLadderCatalog,
        ).description,
        contains('200 chat'),
      );
      expect(
        currentPlanView(
          subscription: _sub(plan: 'pro_v2', currentPriceId: 'price_pro_m'),
          catalog: _newLadderCatalog,
        ).description,
        contains('1,000 chat'),
      );
    });

    test('pro alias on the wire is Architect, labeled Legacy', () {
      final view = currentPlanView(
        subscription: _sub(plan: 'pro', currentPriceId: 'price_arch_m'),
        catalog: _keepUntilCancelCatalog,
      );
      expect(view.baseTitle, 'Architect');
      expect(view.titled(legacySuffix: defaultLegacyPlanTitleSuffix), 'Architect (Legacy Plan)');
    });

    test('purchase-grid titles suffix only keep-until-cancel rows', () {
      expect(catalogPlanDisplayTitle(_newLadderCatalog.first, legacySuffix: defaultLegacyPlanTitleSuffix), 'Plus');
      expect(
        catalogPlanDisplayTitle(_keepUntilCancelCatalog.first, legacySuffix: defaultLegacyPlanTitleSuffix),
        'Neo (Legacy Plan)',
      );
    });
  });

  group('SubscriptionPlan wire passthrough', () {
    test('keeps description and legacy from the generated catalog row', () {
      final plan = SubscriptionPlan.fromJson({
        'id': 'unlimited',
        'title': 'Neo',
        'description': '200 chat questions per month. Unlimited transcription.',
        'legacy': true,
        'features': <String>['feature-a'],
        'prices': [
          {'id': 'price_neo_m', 'title': 'Monthly', 'price_string': '\$19.99/month'},
        ],
      });
      expect(plan.legacy, isTrue);
      expect(plan.description, contains('200 chat'));
      expect(plan.toJson()['legacy'], isTrue);
      expect(plan.toJson()['description'], contains('200 chat'));
    });
  });
}
