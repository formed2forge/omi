import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:omi/l10n/app_localizations.dart';
import 'package:omi/utils/l10n_extensions.dart';

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
// Harness replicating the "fetch failed outright" branch of
// UsagePage._buildSubscriptionInfo (app/lib/pages/settings/usage_page.dart).
//
// Regression: UsageProvider.fetchSubscription() catches a failed request
// (e.g. the server 500s trying to resolve this account's plan — malformed or
// wholly unrecognized catalog data server-side, distinct from the
// recognized-but-unknown-plan case covered by usage_page_unknown_plan_card_test.dart)
// and sets `error` while leaving `subscription` null. The page used to check
// only `subscription == null` and render nothing at all — the exact same
// silent-blank-card defect as the unknown-plan case, just reached through a
// different path (an HTTP failure instead of a parsed-but-unrecognized plan).
// The fix shows the shared error+retry card whenever subscription is null
// *and* an error was actually recorded, instead of only for the unknown-plan
// case.
// ---------------------------------------------------------------------------

class FetchFailedCardHarness extends StatelessWidget {
  const FetchFailedCardHarness(
      {super.key, required this.subscriptionIsNull, required this.error, required this.onRetry});
  final bool subscriptionIsNull;
  final String? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Column(children: [_buildSubscriptionInfo(context)]));
  }

  Widget _buildSubscriptionInfo(BuildContext context) {
    if (!subscriptionIsNull) {
      return const SizedBox.shrink();
    }
    if (error == null) {
      // No subscription yet, but no failed fetch either (e.g. first frame
      // before any request has completed) — nothing to report yet.
      return const SizedBox.shrink();
    }
    return Container(
      key: const Key('plan_usage_error_card'),
      margin: const EdgeInsets.fromLTRB(16, 24, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1F1F25),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.l10n.unableToLoadPlans, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(context.l10n.somethingWentWrongTryAgain, style: TextStyle(fontSize: 13, color: Colors.grey.shade500)),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton(
              key: const Key('plan_usage_error_retry_button'),
              onPressed: onRetry,
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: Colors.grey.shade400),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(context.l10n.retry),
            ),
          ),
        ],
      ),
    );
  }
}

void main() {
  group('Fetch-failed plan card (blank-card regression, non-unknown-plan path)', () {
    testWidgets('shows the explicit error card with a retry action when subscription is null but an error was recorded',
        (tester) async {
      await tester.pumpWidget(
        buildTestApp(FetchFailedCardHarness(
          subscriptionIsNull: true,
          error: 'Failed to load subscription data. Please try again later.',
          onRetry: () {},
        )),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_usage_error_card')), findsOneWidget);
      expect(find.text('Unable to load plans'), findsOneWidget);
      expect(find.text('Something went wrong! Please try again later.'), findsOneWidget);
      expect(find.byKey(const Key('plan_usage_error_retry_button')), findsOneWidget);
    });

    testWidgets('renders nothing when subscription is null and no fetch has failed yet', (tester) async {
      await tester.pumpWidget(
        buildTestApp(FetchFailedCardHarness(subscriptionIsNull: true, error: null, onRetry: () {})),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_usage_error_card')), findsNothing);
    });

    testWidgets('tapping retry invokes the retry callback so a later successful fetch can recover', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        buildTestApp(FetchFailedCardHarness(
          subscriptionIsNull: true,
          error: 'Failed to load subscription data. Please try again later.',
          onRetry: () => retried = true,
        )),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('plan_usage_error_retry_button')));
      await tester.pump();

      expect(retried, isTrue);
    });
  });
}
