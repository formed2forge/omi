import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:omi/flavors.dart';
import 'package:omi/l10n/app_localizations.dart';
import 'package:omi/pages/onboarding/local_dev_sign_in.dart';

void main() {
  late Environment originalEnv;
  setUp(() => originalEnv = F.env);
  tearDown(() => F.env = originalEnv);
  Widget host({required Future<void> Function(String) signIn, bool loading = false}) => MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: LocalDevSignIn(loading: loading, onSignIn: signIn)),
      );
  testWidgets('selects and submits a seeded pricing user', (tester) async {
    F.env = Environment.dev;
    String? selected;
    await tester.pumpWidget(host(signIn: (uid) async {
      selected = uid;
    }));
    await tester.tap(find.byKey(const ValueKey('local-dev-sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('pricing_plus'), findsOneWidget);
    final field = find.byKey(const ValueKey('local-dev-user-id'));
    await tester.enterText(field, ' ');
    await tester.pump();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('local-dev-sign-in-submit'))).onPressed, isNull);
    await tester.enterText(field, ' pricing_pro_v2 ');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('local-dev-sign-in-submit')));
    await tester.pumpAndSettle();
    expect(selected, 'pricing_pro_v2');
    expect(tester.takeException(), isNull);
  });
  testWidgets('production has no local sign-in control', (tester) async {
    F.env = Environment.prod;
    await tester.pumpWidget(host(signIn: (_) async => fail('signed in')));
    expect(find.byKey(const ValueKey('local-dev-sign-in')), findsNothing);
  });
  testWidgets('in-flight sign-in disables repeated submissions', (tester) async {
    F.env = Environment.dev;
    await tester.pumpWidget(host(loading: true, signIn: (_) async => fail('signed in')));
    expect(tester.widget<OutlinedButton>(find.byKey(const ValueKey('local-dev-sign-in'))).onPressed, isNull);
  });
}
