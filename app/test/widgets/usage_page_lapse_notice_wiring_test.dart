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

/// Harness replicating UsagePage._buildSubscriptionInfo's lapse-notice
/// wiring decision ("only render when `response.lapse` is non-null") without
/// the full UsagePage widget tree and its HTTP dependencies — same pattern as
/// FairUseBannerHarness in usage_page_fair_use_banner_test.dart.
class LapseNoticeWiringHarness extends StatelessWidget {
  const LapseNoticeWiringHarness({super.key, required this.response});
  final UserSubscriptionResponse response;

  @override
  Widget build(BuildContext context) {
    final lapse = response.lapse;
    return Scaffold(
      body: Column(
        children: [
          if (lapse != null) SubscriptionLapseNoticeCard(lapse: lapse, onKeepSubscription: () {}, onResubscribe: () {}),
        ],
      ),
    );
  }
}

/// Realistic GET /v1/users/me/subscription response fixture, decoded through
/// the real UserSubscriptionResponse.fromJson (the same path the app uses).
UserSubscriptionResponse _fixture({required String plan, Map<String, dynamic>? lapse}) {
  return UserSubscriptionResponse.fromJson({
    'subscription': {
      'plan': plan,
      'status': 'active',
      'cancel_at_period_end': false,
    },
    'transcription_seconds_used': 0,
    'transcription_seconds_limit': 300,
    'words_transcribed_used': 0,
    'words_transcribed_limit': 1000,
    'insights_gained_used': 0,
    'insights_gained_limit': 10,
    'lapse': lapse,
  });
}

void main() {
  group('No lapse notice when the backend reports no lapse (over-triggering regression)', () {
    testWidgets('always-Free account: neither notice renders', (tester) async {
      final response = _fixture(plan: 'basic', lapse: null);
      expect(response.lapse, isNull);

      await tester.pumpWidget(buildTestApp(LapseNoticeWiringHarness(response: response)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsNothing);
      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsNothing);
    });

    testWidgets('active paid plan with no lapse: neither notice renders', (tester) async {
      final response = _fixture(plan: 'unlimited', lapse: null);
      expect(response.lapse, isNull);

      await tester.pumpWidget(buildTestApp(LapseNoticeWiringHarness(response: response)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsNothing);
      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsNothing);
    });

    testWidgets('unknown-plan sentinel account: neither notice renders', (tester) async {
      // A corrupted/unrecognized plan value is handled by its own
      // planIssueContactSupport card (PlanErrorCard), not this notice — the
      // backend's lapse field is null here too, since a corrupted-plan
      // account isn't provably a lapsed-real-subscription.
      final response = _fixture(plan: 'some_future_plan_id', lapse: null);
      expect(response.subscription.plan.isUnknown, isTrue);
      expect(response.lapse, isNull);

      await tester.pumpWidget(buildTestApp(LapseNoticeWiringHarness(response: response)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsNothing);
      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsNothing);
    });
  });

  group('Lapse notice renders when the backend does report a lapse', () {
    testWidgets('cancellation_scheduled decodes from wire JSON and renders the keep-subscription notice',
        (tester) async {
      final response = _fixture(
        plan: 'unlimited',
        lapse: {
          'state': 'cancellation_scheduled',
          'reason': 'user_requested',
          'recovery_action': 'keep_subscription',
          'effective_at': 1760000000,
        },
      );
      expect(response.lapse?.state, SubscriptionLapseState.cancellationScheduled);

      await tester.pumpWidget(buildTestApp(LapseNoticeWiringHarness(response: response)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsOneWidget);
      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsNothing);
    });

    testWidgets('access_ended decodes from wire JSON and renders the resubscribe notice', (tester) async {
      final response = _fixture(
        plan: 'basic',
        lapse: {
          'state': 'access_ended',
          'reason': 'unknown',
          'recovery_action': 'resubscribe',
          'effective_at': 1758000000,
        },
      );
      expect(response.lapse?.state, SubscriptionLapseState.accessEnded);

      await tester.pumpWidget(buildTestApp(LapseNoticeWiringHarness(response: response)));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('plan_lapse_notice_access_ended')), findsOneWidget);
      expect(find.byKey(const Key('plan_lapse_notice_cancellation_scheduled')), findsNothing);
    });
  });
}
