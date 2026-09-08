import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:omi/backend/http/api/users.dart';
import 'package:omi/models/subscription.dart';
import 'package:omi/providers/usage_provider.dart';

// ---------------------------------------------------------------------------
// The real fetch path: MockClient response -> getUserSubscription() status
// handling -> UsageProvider.fetchSubscription() state.
//
// Regression: getUserSubscription() collapsed every non-200 to a silent null
// and fetchSubscription() assigned that null without throwing, so `_error`
// stayed null on a real HTTP 500. The plan card renders only when
// `subscription == null && error != null` (or the plan is unknown), so the
// user saw a blank card with no way to recover.
//
// The existing usage_page_*_card_test.dart files inject the rendered state
// directly; they cannot catch this. These tests go through the production
// status-code branching.
// ---------------------------------------------------------------------------

const String _subscriptionUrl = 'https://backend.test/v1/users/me/subscription';

Map<String, dynamic> _snapshotJson({required String plan, required String status}) {
  return {
    'subscription': {
      'plan': plan,
      'status': status,
      'current_period_end': null,
      'current_period_start': null,
      'stripe_subscription_id': null,
      'current_price_id': null,
      'features': <String>[],
      'cancel_at_period_end': false,
      'limits': {
        'transcription_seconds': 0,
        'words_transcribed': 0,
        'insights_gained': 0,
        'chat_questions_per_month': 0,
        'chat_cost_usd_per_month': null,
      },
      'deprecated': false,
      'deprecation_message': null,
    },
    'transcription_seconds_used': 0,
    'transcription_seconds_limit': 0,
    'words_transcribed_used': 0,
    'words_transcribed_limit': 0,
    'insights_gained_used': 0,
    'insights_gained_limit': 0,
    'available_plans': <dynamic>[],
    'show_subscription_ui': true,
    'chat_quota_used': 0.0,
    'chat_quota_unit': null,
    'chat_quota_percent': 0.0,
    'chat_quota_allowed': true,
    'chat_quota_reset_at': null,
    'phone_call_quota': null,
  };
}

/// Wires a canned HTTP response through the production fetch function.
void _respondWith(UsageProvider provider, http.Response response) {
  final client = MockClient((_) async => response);
  provider.subscriptionFetcher = () => getUserSubscription(
        httpCall: () => client.get(Uri.parse(_subscriptionUrl)),
      );
}

void main() {
  group('getUserSubscription status handling', () {
    test('decodes a recognized plan (regression: the happy path is unchanged)', () async {
      final client = MockClient(
        (_) async => http.Response(jsonEncode(_snapshotJson(plan: 'unlimited', status: 'active')), 200),
      );

      final result = await getUserSubscription(httpCall: () => client.get(Uri.parse(_subscriptionUrl)));

      expect(result.subscription.plan, PlanType.unlimited);
      expect(result.subscription.plan.isUnknown, isFalse);
      expect(result.subscription.status, SubscriptionStatus.active);
    });

    test('keeps the backend unknown-plan sentinel as an unknown plan, never Free', () async {
      // The backend returns HTTP 200 with plan="unknown" when the stored plan
      // is outside its catalog enum. Decoding that as `basic` would tell a
      // possibly-paying user they are on the free tier.
      final client = MockClient(
        (_) async => http.Response(jsonEncode(_snapshotJson(plan: 'unknown', status: 'inactive')), 200),
      );

      final result = await getUserSubscription(httpCall: () => client.get(Uri.parse(_subscriptionUrl)));

      expect(result.subscription.plan.isUnknown, isTrue);
      expect(result.subscription.plan.wireName, 'unknown');
      expect(result.subscription.plan, isNot(PlanType.basic));
      expect(result.subscription.plan.isPaid, isFalse);
    });

    test('throws on a non-200 instead of resolving to null', () async {
      final client = MockClient((_) async => http.Response('Internal Server Error', 500));

      await expectLater(
        getUserSubscription(httpCall: () => client.get(Uri.parse(_subscriptionUrl))),
        throwsA(isA<SubscriptionFetchException>().having((e) => e.statusCode, 'statusCode', 500)),
      );
    });

    test('throws when the request produced no response at all', () async {
      // makeApiCall returns null when the request never reached the server
      // (auth unavailable, transport failure).
      await expectLater(
        getUserSubscription(httpCall: () async => null),
        throwsA(isA<SubscriptionFetchException>().having((e) => e.statusCode, 'statusCode', isNull)),
      );
    });
  });

  group('UsageProvider.fetchSubscription through the real status handling', () {
    test('a backend 500 records an error so the plan card can render', () async {
      final provider = UsageProvider();
      _respondWith(provider, http.Response('Internal Server Error', 500));

      await provider.fetchSubscription();

      // Both conditions the page checks for the error card.
      expect(provider.subscription, isNull);
      expect(provider.error, isNotNull);
    });

    test('the unknown-plan 200 loads as an unknown plan, not a silent Free', () async {
      final provider = UsageProvider();
      _respondWith(
        provider,
        http.Response(jsonEncode(_snapshotJson(plan: 'unknown', status: 'inactive')), 200),
      );

      await provider.fetchSubscription();

      expect(provider.error, isNull); // a successful response, not a fetch failure
      expect(provider.subscription, isNotNull);
      expect(provider.subscription!.subscription.plan.isUnknown, isTrue);
      // No entitlement is inferred from an unresolvable plan.
      expect(provider.subscription!.subscription.plan.isPaid, isFalse);
    });

    test('a recognized plan still loads normally', () async {
      final provider = UsageProvider();
      _respondWith(
        provider,
        http.Response(jsonEncode(_snapshotJson(plan: 'unlimited', status: 'active')), 200),
      );

      await provider.fetchSubscription();

      expect(provider.error, isNull);
      expect(provider.subscription!.subscription.plan, PlanType.unlimited);
    });

    test('a failed fetch notifies listeners so the page rebuilds into the error state', () async {
      final provider = UsageProvider();
      _respondWith(provider, http.Response('nope', 503));

      var notified = 0;
      provider.addListener(() => notified++);

      await provider.fetchSubscription();

      expect(notified, greaterThan(0));
      expect(provider.error, isNotNull);
    });
  });
}
