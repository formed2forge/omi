import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:omi/l10n/app_localizations.dart';
import 'package:omi/pages/settings/widgets/plans_sheet_close_button.dart';

/// Regression coverage for the Change Plan sheet's dismissal defect: a QA
/// tester had no discoverable, accessible way to leave the sheet and had to
/// hot-restart the app. The sheet's only prior exits were implicit (drag the
/// DraggableScrollableSheet down to its minChildSize, or tap the sliver of
/// modal barrier above it) — neither exposes an activatable control to a
/// screen reader or to UI automation.
///
/// This exercises the real [PlansSheetCloseButton] production widget (not a
/// reimplemented copy) inside a genuine `showModalBottomSheet` round trip:
/// open the sheet, confirm its content is present, tap the close control by
/// the same key/semantics a screen reader or automation would use, and assert
/// the sheet is actually gone — not just that the button exists in the tree.
Widget _harness() {
  return MaterialApp(
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: const [Locale('en')],
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: ElevatedButton(
            key: const Key('open_sheet'),
            onPressed: () {
              showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                builder: (_) => const SizedBox(
                  height: 400,
                  child: Stack(
                    children: [
                      Center(child: Text('Change Plan sheet content', key: Key('sheet_content_marker'))),
                      PlansSheetCloseButton(),
                    ],
                  ),
                ),
              );
            },
            child: const Text('Open'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  group('PlansSheetCloseButton', () {
    testWidgets('tapping it dismisses the sheet', (tester) async {
      await tester.pumpWidget(_harness());

      // Open the sheet the way _showPlansSheet / _showPlansSheetOnQuotaExceeded
      // do in production: showModalBottomSheet.
      await tester.tap(find.byKey(const Key('open_sheet')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('sheet_content_marker')), findsOneWidget,
          reason: 'sheet must actually be open before we can test dismissing it');

      final closeButton = find.byKey(PlansSheetCloseButton.buttonKey);
      expect(closeButton, findsOneWidget);

      // Reachable by UI automation: a real Key, not a bare icon buried in a
      // decorative drag handle.
      await tester.tap(closeButton);
      await tester.pumpAndSettle();

      // The sheet — and everything in it — must be gone, not just covered.
      expect(find.byKey(const Key('sheet_content_marker')), findsNothing);
      expect(find.byKey(PlansSheetCloseButton.buttonKey), findsNothing);
    });

    testWidgets('exposes a screen-reader-discoverable semantic label', (tester) async {
      await tester.pumpWidget(_harness());
      await tester.tap(find.byKey(const Key('open_sheet')));
      await tester.pumpAndSettle();

      // Reachable by a screen reader: the tooltip becomes the button's
      // semantic label, so VoiceOver/TalkBack announce it as "Close" rather
      // than an unlabeled icon.
      expect(find.byTooltip('Close'), findsOneWidget);
    });
  });
}
