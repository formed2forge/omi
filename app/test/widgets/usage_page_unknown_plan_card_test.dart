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
// Rendering coverage for the unknown-plan branch of
// UsagePage._buildSubscriptionInfo (app/lib/pages/settings/usage_page.dart),
// which delegates to the real PlanErrorCard pumped below.
//
// Defect 2 regression: an unrecognized/future plan id used to render nothing
// at all above the usage-insights section.
//
// This file covers rendering only. The fetch path that produces this state is
// covered by test/providers/usage_provider_fetch_error_test.dart.
// ---------------------------------------------------------------------------

void main() {
  group('Unknown plan card (Defect 2 regression)', () {
    testWidgets('shows the contact-support message, not a blank space', (tester) async {
      await tester.pumpWidget(
        buildTestApp(Scaffold(body: PlanErrorCard(unknownPlan: true, onRetry: () {}))),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_usage_error_card')), findsOneWidget);
      expect(find.text('Unable to load plans'), findsOneWidget);
      expect(
        find.text(
          'There may be an issue with your plan, please contact support to '
          'ensure there is no interruption in your service.',
        ),
        findsOneWidget,
      );
      // Must not imply cancellation or invite a second purchase: the account
      // may still be actively paying.
      expect(find.text('Something went wrong! Please try again later.'), findsNothing);
    });

    testWidgets('always offers the support action, not retry alone', (tester) async {
      // A persistently unresolvable plan never resolves itself by retrying, so
      // the support action is the real recovery and must always be present.
      var contacted = false;
      await tester.pumpWidget(
        buildTestApp(Scaffold(
          body: PlanErrorCard(
            unknownPlan: true,
            onRetry: () {},
            onContactSupport: () async => contacted = true,
          ),
        )),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_usage_error_support_button')), findsOneWidget);
      expect(find.text('Help Center'), findsOneWidget);

      await tester.tap(find.byKey(const Key('plan_usage_error_support_button')));
      await tester.pump();

      expect(contacted, isTrue);
    });

    testWidgets('tapping retry invokes the retry callback so a later valid plan can recover', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        buildTestApp(Scaffold(body: PlanErrorCard(unknownPlan: true, onRetry: () => retried = true))),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('plan_usage_error_retry_button')));
      await tester.pump();

      expect(retried, isTrue);
    });
  });
}
