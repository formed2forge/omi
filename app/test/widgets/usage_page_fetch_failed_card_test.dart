import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:omi/l10n/app_localizations.dart';
import 'package:omi/pages/settings/widgets/plan_error_card.dart';

/// Wraps [child] in a MaterialApp with l10n delegates so context.l10n works.
Widget buildTestApp(Widget child) {
  return MaterialApp(
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: const [Locale('en')],
    home: child,
  );
}

// ---------------------------------------------------------------------------
// Rendering coverage for the "fetch failed outright" branch of
// UsagePage._buildSubscriptionInfo (app/lib/pages/settings/usage_page.dart),
// which delegates to the real PlanErrorCard pumped below.
//
// Regression: UsageProvider.fetchSubscription() records an error while leaving
// `subscription` null. The page used to check only `subscription == null` and
// render nothing at all.
//
// This file covers rendering only — it deliberately does NOT prove that a real
// backend error reaches this state. That is
// test/providers/usage_provider_fetch_error_test.dart, which drives the real
// HTTP status handling in getUserSubscription().
// ---------------------------------------------------------------------------

void main() {
  group('Fetch-failed plan card (blank-card regression, non-unknown-plan path)', () {
    testWidgets('shows the retryable error card, not the contact-support copy', (tester) async {
      // A transient fetch failure IS retryable, so it must not tell the user
      // their plan is broken and send them to support.
      await tester.pumpWidget(buildTestApp(Scaffold(body: PlanErrorCard(unknownPlan: false, onRetry: () {}))));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_usage_error_card')), findsOneWidget);
      expect(find.text('Unable to load plans'), findsOneWidget);
      expect(find.text('Something went wrong! Please try again later.'), findsOneWidget);
      expect(find.byKey(const Key('plan_usage_error_retry_button')), findsOneWidget);
      expect(find.byKey(const Key('plan_usage_error_support_button')), findsNothing);
    });

    testWidgets('tapping retry invokes the retry callback so a later successful fetch can recover', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        buildTestApp(Scaffold(body: PlanErrorCard(unknownPlan: false, onRetry: () => retried = true))),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('plan_usage_error_retry_button')));
      await tester.pump();

      expect(retried, isTrue);
    });
  });
}
