import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:omi/l10n/app_localizations.dart';
import 'package:omi/models/subscription.dart';
import 'package:omi/pages/settings/widgets/subscription_lapse_notice_card.dart';

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
// Regression coverage for the Plan & Usage lapse notice
// (SubscriptionLapseNoticeCard, wired into
// UsagePage._buildSubscriptionInfo). The backend's `lapse` field on
// GET /v1/users/me/subscription is null for every always-Free account,
// active-paid account, and the unknown-plan sentinel — this suite locks in
// that the two real states each render their own notice+action and that a
// null lapse (covered by the sibling error-card tests already existing for
// the unknown-plan branch) never triggers either.
// ---------------------------------------------------------------------------

void main() {
  group('cancellation_scheduled', () {
    final lapse = SubscriptionLapse(
      state: SubscriptionLapseState.cancellationScheduled,
      reason: SubscriptionLapseReason.userRequested,
      recoveryAction: SubscriptionLapseRecovery.keepSubscription,
      // Noon UTC so the local-time DateFormat rendering stays on Oct 15 in
      // every reasonable test-runner timezone (midnight UTC would roll back
      // to Oct 14 in negative-offset zones).
      effectiveAt: DateTime.utc(2026, 10, 15, 12).millisecondsSinceEpoch ~/ 1000,
    );

    testWidgets('renders the calm keep-subscription notice and action', (tester) async {
      await tester.pumpWidget(
        buildTestApp(Scaffold(
          body: SubscriptionLapseNoticeCard(lapse: lapse, onKeepSubscription: () {}, onResubscribe: () {}),
        )),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsOneWidget);
      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsNothing);
      expect(
        find.text("Your plan will end on Oct 15, 2026. You'll keep full access until then."),
        findsOneWidget,
      );
      expect(find.byKey(const Key('plan_lapse_keep_subscription_button')), findsOneWidget);
      expect(find.byKey(const Key('plan_lapse_resubscribe_button')), findsNothing);
      expect(find.text('Keep My Plan'), findsOneWidget);
    });

    testWidgets('tapping "Keep My Plan" invokes the reactivation callback, not resubscribe', (tester) async {
      var kept = false;
      var resubscribed = false;
      await tester.pumpWidget(
        buildTestApp(Scaffold(
          body: SubscriptionLapseNoticeCard(
            lapse: lapse,
            onKeepSubscription: () => kept = true,
            onResubscribe: () => resubscribed = true,
          ),
        )),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('plan_lapse_keep_subscription_button')));
      await tester.pump();

      expect(kept, isTrue);
      expect(resubscribed, isFalse);
    });

    testWidgets('the action is disabled while busy', (tester) async {
      var kept = false;
      await tester.pumpWidget(
        buildTestApp(Scaffold(
          body: SubscriptionLapseNoticeCard(
            lapse: lapse,
            busy: true,
            onKeepSubscription: () => kept = true,
            onResubscribe: () {},
          ),
        )),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('plan_lapse_keep_subscription_button')));
      await tester.pump();

      expect(kept, isFalse);
    });
  });

  group('access_ended', () {
    final lapse = SubscriptionLapse(
      state: SubscriptionLapseState.accessEnded,
      reason: SubscriptionLapseReason.unknown,
      recoveryAction: SubscriptionLapseRecovery.resubscribe,
      effectiveAt: DateTime.utc(2026, 9, 1).millisecondsSinceEpoch ~/ 1000,
    );

    testWidgets('renders the resubscribe notice with neutral copy (no specific-cause claim)', (tester) async {
      await tester.pumpWidget(
        buildTestApp(Scaffold(
          body: SubscriptionLapseNoticeCard(lapse: lapse, onKeepSubscription: () {}, onResubscribe: () {}),
        )),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsOneWidget);
      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsNothing);

      final messageFinder = find.text('Your paid access has ended.');
      expect(messageFinder, findsOneWidget);

      // The backend's `reason` is always `unknown` for this state (it cannot
      // honestly attribute cancellation / expiration / payment failure after
      // the fact) — the copy must never guess at a specific cause.
      final Text messageWidget = tester.widget(messageFinder);
      final renderedText = messageWidget.data ?? '';
      expect(renderedText.toLowerCase(), isNot(contains('cancel')));
      expect(renderedText.toLowerCase(), isNot(contains('payment failed')));
      expect(renderedText.toLowerCase(), isNot(contains('expired')));

      expect(find.byKey(const Key('plan_lapse_resubscribe_button')), findsOneWidget);
      expect(find.byKey(const Key('plan_lapse_keep_subscription_button')), findsNothing);
      expect(find.text('Resubscribe'), findsOneWidget);
    });

    testWidgets('tapping "Resubscribe" invokes the resubscribe callback, not keep-subscription', (tester) async {
      var kept = false;
      var resubscribed = false;
      await tester.pumpWidget(
        buildTestApp(Scaffold(
          body: SubscriptionLapseNoticeCard(
            lapse: lapse,
            onKeepSubscription: () => kept = true,
            onResubscribe: () => resubscribed = true,
          ),
        )),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('plan_lapse_resubscribe_button')));
      await tester.pump();

      expect(resubscribed, isTrue);
      expect(kept, isFalse);
    });
  });
}
