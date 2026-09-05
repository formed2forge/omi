import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:omi/env/environment_profile.dart';

/// Keeps the emulator-only gate ahead of networking and Firebase token exchange.
Future<T> exchangeLocalDevToken<T>({
  required AppEnvironmentProfile profile,
  required String Function() apiBaseUrl,
  required String uid,
  required Future<http.Response> Function(Uri url, {Map<String, String>? headers, Object? body}) post,
  required Future<T> Function(String token) signIn,
}) async {
  if (profile != AppEnvironmentProfile.localDev) {
    throw StateError('Local development sign-in is only available in the local_dev profile.');
  }
  final normalizedUid = uid.trim();
  if (normalizedUid.isEmpty || normalizedUid.length > 128) {
    throw ArgumentError.value(uid, 'uid', 'Expected 1–128 characters');
  }
  final base = apiBaseUrl().replaceFirst(RegExp(r'/+$'), '');
  final response = await post(
    Uri.parse('$base/v1/auth/local-dev/custom-token'),
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: {'uid': normalizedUid},
  ).timeout(const Duration(seconds: 15));
  if (response.statusCode != 200) {
    throw StateError('Local development sign-in failed: HTTP ${response.statusCode}');
  }
  final decoded = json.decode(response.body) as Map<String, dynamic>;
  final customToken = decoded['custom_token'] as String?;
  if (customToken == null || customToken.isEmpty) {
    throw StateError('Local development sign-in returned no custom token');
  }
  return signIn(customToken);
}
