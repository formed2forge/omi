import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:omi/env/local_dev_onboarding_bypass.dart';

void main() {
  group('resolveLocalDevOnboardingBypassActive', () {
    // Shared contract: contracts/parity/local_dev_onboarding_bypass.json's
    // gate_cases — every platform's gate must agree on this exact truth table.
    test('production_default', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: false, bypassFlagValue: null),
        isFalse,
      );
    });

    test('local_dev_no_flag', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: true, bypassFlagValue: null),
        isFalse,
      );
    });

    test('local_dev_flag_explicit_off', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: true, bypassFlagValue: '0'),
        isFalse,
      );
    });

    test('local_dev_flag_on', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: true, bypassFlagValue: '1'),
        isTrue,
      );
    });

    test('production_flag_on_is_still_refused', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: false, bypassFlagValue: '1'),
        isFalse,
      );
    });

    test('malformed_flag_value_refused', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: true, bypassFlagValue: 'yes'),
        isFalse,
      );
    });

    test('whitespace_flag_value_refused', () {
      expect(
        resolveLocalDevOnboardingBypassActive(localDevProfileActive: true, bypassFlagValue: '  1  '),
        isFalse,
      );
    });
  });

  group('isLocalDevOnboardingBypassIdentity', () {
    test('matches only the exact fixture uid', () {
      expect(isLocalDevOnboardingBypassIdentity(kLocalDevFixtureUid), isTrue);
    });

    test('rejects any other uid, including a manually-typed pricing fixture', () {
      expect(isLocalDevOnboardingBypassIdentity('pricing_plus'), isFalse);
      expect(isLocalDevOnboardingBypassIdentity(null), isFalse);
      expect(isLocalDevOnboardingBypassIdentity(''), isFalse);
    });
  });

  group('resolveMobileAppRoute', () {
    test('normal signed-in flow is unaffected when the bypass is not satisfied', () {
      expect(
        resolveMobileAppRoute(
          aiConsentGiven: false,
          onboardingCompleted: false,
          permissionsCompleted: false,
          bypassSatisfied: false,
        ),
        MobileAppRoute.onboarding,
      );
      expect(
        resolveMobileAppRoute(
          aiConsentGiven: true,
          onboardingCompleted: true,
          permissionsCompleted: false,
          bypassSatisfied: false,
        ),
        MobileAppRoute.permissionsGate,
      );
      expect(
        resolveMobileAppRoute(
          aiConsentGiven: true,
          onboardingCompleted: true,
          permissionsCompleted: true,
          bypassSatisfied: false,
        ),
        MobileAppRoute.home,
      );
    });

    test('a satisfied bypass reaches home even with every persisted flag false', () {
      expect(
        resolveMobileAppRoute(
          aiConsentGiven: false,
          onboardingCompleted: false,
          permissionsCompleted: false,
          bypassSatisfied: true,
        ),
        MobileAppRoute.home,
      );
    });

    test('an unsatisfied bypass never overrides a real user still onboarding', () {
      // Regression guard for "must not bypass onboarding based only on an
      // existing login": bypassSatisfied=false (e.g. a manually-typed
      // pricing_plus session, or the bypass flag off) must still onboard even
      // though the caller IS signed in (this function only runs post-sign-in).
      expect(
        resolveMobileAppRoute(
          aiConsentGiven: false,
          onboardingCompleted: false,
          permissionsCompleted: false,
          bypassSatisfied: false,
        ),
        isNot(MobileAppRoute.home),
      );
    });
  });

  group('shared contract conformance (contracts/parity/local_dev_onboarding_bypass.json)', () {
    late Map<String, dynamic> contract;

    setUpAll(() {
      // Repo-relative path from app/ (flutter test's cwd is the package root).
      final file = File('../contracts/parity/local_dev_onboarding_bypass.json');
      contract = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    });

    test('fixture uid matches this platform implementation', () {
      final identity = contract['fixture_identity'] as Map<String, dynamic>;
      expect(kLocalDevFixtureUid, identity['uid']);
    });

    test('names this platform flag in platform_flag_names', () {
      final flagNames = contract['platform_flag_names'] as Map<String, dynamic>;
      expect(flagNames['mobile'], 'OMI_LOCAL_DEV_ONBOARDING_BYPASS');
    });

    test('every gate_case agrees with the production gate function', () {
      final cases = contract['gate_cases'] as List<dynamic>;
      for (final raw in cases) {
        final c = raw as Map<String, dynamic>;
        final result = resolveLocalDevOnboardingBypassActive(
          localDevProfileActive: c['local_dev_profile_active'] as bool,
          bypassFlagValue: c['bypass_flag_value'] as String?,
        );
        expect(result, c['expected_bypass_active'], reason: 'case: ${c['name']}');
      }
    });
  });
}
