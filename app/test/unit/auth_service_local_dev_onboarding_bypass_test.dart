import 'package:flutter_test/flutter_test.dart';
import 'package:omi/env/env.dart';
import 'package:omi/env/environment_profile.dart';
import 'package:omi/env/local_dev_onboarding_bypass.dart';
import 'package:omi/flavors.dart';
import 'package:omi/services/auth_service.dart';

void main() {
  group('AuthService.signInWithLocalDevOnboardingBypass', () {
    late Environment originalEnv;

    setUp(() => originalEnv = F.env);
    tearDown(() => F.env = originalEnv);

    test('refuses to run in a production-family build, before any network call', () async {
      // Reuses signInWithLocalDevToken's fail-closed gate — same reasoning as
      // auth_service_local_dev_test.dart's equivalent case: the absence of any
      // HTTP stubbing means this only passes if the StateError is thrown
      // before the call ever reaches http.post.
      F.env = Environment.prod;
      expect(Env.profile, AppEnvironmentProfile.production);

      await expectLater(
        AuthService.instance.signInWithLocalDevOnboardingBypass(),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            contains('only available in the local_dev profile'),
          ),
        ),
      );
    });

    test('uses the shared canonical fixture uid, not an arbitrary default', () {
      // The bypass must always target the ONE cross-platform fixture identity
      // (contracts/parity/local_dev_onboarding_bypass.json) — never a
      // caller-supplied or differently-defaulted uid, unlike the generic
      // signInWithLocalDevToken(uid: ...).
      expect(kLocalDevFixtureUid, 'local_dev_fixture');
    });
  });
}
