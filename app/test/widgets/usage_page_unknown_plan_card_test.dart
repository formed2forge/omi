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
// Harness replicating the unknown-plan branch of
// UsagePage._buildSubscriptionInfo (app/lib/pages/settings/usage_page.dart).
// Defect 2 regression: an unrecognized/future plan id used to render nothing
// at all above the usage-insights section. The fix shows this explicit
// error+retry card instead of silently returning SizedBox.shrink().
// ---------------------------------------------------------------------------

class UnknownPlanCardHarness extends StatelessWidget {
  const UnknownPlanCardHarness({super.key, required this.isUnknownPlan, required this.onRetry});
  final bool isUnknownPlan;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Column(children: [_buildSubscriptionInfo(context)]));
  }

  Widget _buildSubscriptionInfo(BuildContext context) {
    if (!isUnknownPlan) {
      return const SizedBox.shrink();
    }
    return Container(
      key: const Key('unknown_plan_card'),
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
              key: const Key('unknown_plan_retry'),
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
  group('Unknown plan card (Defect 2 regression)', () {
    testWidgets('shows an explicit error card with a retry action, not a blank space', (tester) async {
      await tester.pumpWidget(
        buildTestApp(UnknownPlanCardHarness(isUnknownPlan: true, onRetry: () {})),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('unknown_plan_card')), findsOneWidget);
      expect(find.text('Unable to load plans'), findsOneWidget);
      expect(find.text('Something went wrong! Please try again later.'), findsOneWidget);
      expect(find.byKey(const Key('unknown_plan_retry')), findsOneWidget);
    });

    testWidgets('renders nothing for a recognized plan', (tester) async {
      await tester.pumpWidget(
        buildTestApp(UnknownPlanCardHarness(isUnknownPlan: false, onRetry: () {})),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('unknown_plan_card')), findsNothing);
    });

    testWidgets('tapping retry invokes the retry callback so a later valid plan can recover', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        buildTestApp(UnknownPlanCardHarness(isUnknownPlan: true, onRetry: () => retried = true)),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('unknown_plan_retry')));
      await tester.pump();

      expect(retried, isTrue);
    });
  });
}
