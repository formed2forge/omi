import 'package:collection/collection.dart';

import 'package:omi/models/subscription.dart';

/// Keep-until-cancel catalog identities. Plus (`plus`) and Pro (`pro_v2`) are
/// sold on the current ladder and are never labeled Legacy.
const Set<String> keepUntilCancelPlanIds = {'unlimited', 'unlimited_v2', 'operator', 'architect'};

const String defaultLegacyPlanTitleSuffix = ' (Legacy Plan)';

/// Product names used when the catalog row cannot be recovered. Matches
/// desktop `PLAN_DISPLAY_NAMES` / BillingHelpers so iOS testers see the same
/// titles as Settings on Mac and Windows.
const Map<String, String> planFallbackTitles = {
  'basic': 'Free',
  'plus': 'Plus',
  'pro_v2': 'Pro',
  'unlimited': 'Neo',
  'unlimited_v2': 'Unlimited',
  'operator': 'Operator',
  'architect': 'Architect',
};

/// Used when `available_plans[].description` is empty. Same copy as desktop
/// BillingHelpers so Neo is never stuck on the stale "100 chat questions"
/// client fallback.
const Map<String, String> planFallbackDescriptions = {
  'basic':
      '30 chat questions per month. 300 minutes of transcription per month, then on-device. Shared with mobile and web.',
  'plus':
      '200 chat questions per month. 1,500 minutes of transcription per month, then on-device. Full desktop, mobile, and web access.',
  'pro_v2': '1,000 chat questions per month. Full desktop, mobile, and web access.',
  'unlimited': '200 chat questions per month. Unlimited transcription. Desktop capture with Free-tier allowance.',
  'unlimited_v2': 'Unlimited transcription — record all day.',
  'operator': '500 chat questions per month. Shared with mobile and web.',
  'architect': 'Power-user AI for heavy agentic workflows and vibe coding.',
};

const String byokPlanTitle = 'Free (BYOK)';
const String byokPlanDescription = 'Your own API keys. Cloud transcription and chat still follow the Free plan.';

/// Catalog row that owns [currentPriceId]. `/v1/users/me/subscription` still
/// serializes Plus / Pro / Unlimited-v2 as `plan=unlimited`; matching by price
/// id is how Settings recovers the title the user actually bought.
SubscriptionPlan? owningCatalogPlan({required String? currentPriceId, required List<SubscriptionPlan> catalog}) {
  final priceId = currentPriceId;
  if (priceId == null || priceId.isEmpty) return null;
  return catalog.firstWhereOrNull((plan) => plan.prices.any((price) => price.id == priceId));
}

bool catalogPlanIsKeepUntilCancel(SubscriptionPlan plan) {
  if (plan.legacy) return true;
  return keepUntilCancelPlanIds.contains(plan.id);
}

bool isKeepUntilCancelPlan({
  required PlanType plan,
  required List<String> features,
  required String? currentPriceId,
  required List<SubscriptionPlan> catalog,
}) {
  if (features.contains('byok')) return false;
  final owning = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog);
  if (owning != null) return catalogPlanIsKeepUntilCancel(owning);
  return keepUntilCancelPlanIds.contains(plan.wireName);
}

String fallbackTitleForPlanId(String planId) => planFallbackTitles[planId] ?? planId;

String fallbackDescriptionForPlanId(String planId) => planFallbackDescriptions[planId] ?? '';

String titledWithLegacySuffix(String title, {required bool isLegacy, required String suffix}) {
  if (!isLegacy) return title;
  if (title.endsWith(suffix)) return title;
  return '$title$suffix';
}

String catalogPlanDisplayTitle(SubscriptionPlan plan, {required String legacySuffix}) {
  return titledWithLegacySuffix(plan.title, isLegacy: catalogPlanIsKeepUntilCancel(plan), suffix: legacySuffix);
}

/// Resolved current-plan copy for Plan & Usage and the plans sheet.
class CurrentPlanView {
  final String baseTitle;
  final bool isKeepUntilCancel;
  final String description;
  final List<String> features;

  const CurrentPlanView({
    required this.baseTitle,
    required this.isKeepUntilCancel,
    required this.description,
    this.features = const [],
  });

  String titled({required String legacySuffix}) {
    return titledWithLegacySuffix(baseTitle, isLegacy: isKeepUntilCancel, suffix: legacySuffix);
  }
}

CurrentPlanView currentPlanView({required Subscription subscription, required List<SubscriptionPlan> catalog}) {
  if (subscription.features.contains('byok')) {
    return const CurrentPlanView(baseTitle: byokPlanTitle, isKeepUntilCancel: false, description: byokPlanDescription);
  }

  final owning = owningCatalogPlan(currentPriceId: subscription.currentPriceId, catalog: catalog);
  final planId = owning?.id ?? subscription.plan.wireName;
  final baseTitle = owning?.title ?? fallbackTitleForPlanId(planId);
  final catalogDescription = owning?.description?.trim();
  final description = (catalogDescription != null && catalogDescription.isNotEmpty)
      ? catalogDescription
      : fallbackDescriptionForPlanId(planId);
  final features = owning != null && owning.features.isNotEmpty ? owning.features.take(4).toList() : const <String>[];

  return CurrentPlanView(
    baseTitle: baseTitle,
    isKeepUntilCancel: isKeepUntilCancelPlan(
      plan: subscription.plan,
      features: subscription.features,
      currentPriceId: subscription.currentPriceId,
      catalog: catalog,
    ),
    description: description,
    features: features,
  );
}
