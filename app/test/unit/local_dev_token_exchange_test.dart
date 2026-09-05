import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:omi/env/environment_profile.dart';
import 'package:omi/services/auth/local_dev_auth.dart';

void main() {
  test('exchanges the selected pricing uid for a Firebase session', () async {
    final result = await exchangeLocalDevToken(
      profile: AppEnvironmentProfile.localDev,
      apiBaseUrl: () => 'http://100.81.134.49:8000',
      uid: ' pricing_pro_v2 ',
      post: (url, {headers, body}) async {
        expect(url.toString(), 'http://100.81.134.49:8000/v1/auth/local-dev/custom-token');
        expect(body, {'uid': 'pricing_pro_v2'});
        return http.Response('{"custom_token":"emulator-token"}', 200);
      },
      signIn: (token) async {
        expect(token, 'emulator-token');
        return 'session';
      },
    );
    expect(result, 'session');
  });
  for (final profile in AppEnvironmentProfile.values.where((p) => p != AppEnvironmentProfile.localDev)) {
    test('${profile.name} rejects sign-in before accessing the backend or Firebase', () async {
      await expectLater(
          exchangeLocalDevToken(
            profile: profile,
            apiBaseUrl: () => throw TestFailure('read endpoint'),
            uid: 'pricing_plus',
            post: (url, {headers, body}) async => throw TestFailure('posted'),
            signIn: (_) async => throw TestFailure('signed in'),
          ),
          throwsStateError);
    });
  }
  for (final response in [http.Response('not found', 404), http.Response('{}', 200)]) {
    test('invalid token response ${response.statusCode}/${response.body} cannot sign in', () async {
      await expectLater(
          exchangeLocalDevToken(
            profile: AppEnvironmentProfile.localDev,
            apiBaseUrl: () => 'http://127.0.0.1:8000/',
            uid: 'pricing_plus',
            post: (url, {headers, body}) async => response,
            signIn: (_) async => throw TestFailure('signed in'),
          ),
          throwsStateError);
    });
  }
}
