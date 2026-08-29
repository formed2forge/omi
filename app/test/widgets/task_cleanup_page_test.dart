import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:omi/backend/http/api/action_items_cleanup.dart';
import 'package:omi/backend/schema/gen/action_items_folders_wire.g.dart' as wire;
import 'package:omi/l10n/app_localizations.dart';
import 'package:omi/pages/settings/task_cleanup_page.dart';

wire.GeneratedCleanupPreviewResponse _previewResponse({int total = 2}) {
  return wire.GeneratedCleanupPreviewResponse(
    sessionId: 'session-1',
    totalCandidates: total,
    breakdown: const {'stale_age': 2},
    sample: const [
      wire.GeneratedCleanupSampleItem(description: 'Sample', strategy: 'stale_age'),
    ],
    candidateIds: const ['a', 'b'],
    candidateMeta: const [
      wire.GeneratedCleanupCandidateMeta(id: 'a', strategy: 'stale_age', description: 'Task A'),
      wire.GeneratedCleanupCandidateMeta(id: 'b', strategy: 'stale_age', description: 'Task B'),
    ],
    expiresInSeconds: 300,
    totalOpenActionItems: 2,
    scanCap: 2000,
    scanTruncated: false,
  );
}

void main() {
  testWidgets('advances from config to preview after analyze succeeds', (tester) async {
    var previewCalls = 0;

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: TaskCleanupPage(
          previewFn: ({required strategies, ageDays = 90, overdueDays = 30, scanCursor}) async {
            previewCalls++;
            expect(strategies, contains('stale_age'));
            return _previewResponse();
          },
          executeFn: ({required sessionId, excludedIds = const []}) async {
            return const wire.GeneratedCleanupExecuteResponse(deletedCount: 0);
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Analyze'), findsOneWidget);
    await tester.tap(find.text('Analyze'));
    await tester.pumpAndSettle();

    expect(previewCalls, 1);
    expect(find.text('Task A'), findsOneWidget);
    expect(find.text('Delete 2 tasks'), findsOneWidget);
  });

  testWidgets('returns to config when preview fails', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: TaskCleanupPage(
          previewFn: ({required strategies, ageDays = 90, overdueDays = 30, scanCursor}) async {
            throw const TaskCleanupApiException('Preview failed', statusCode: 500);
          },
          executeFn: ({required sessionId, excludedIds = const []}) async {
            return const wire.GeneratedCleanupExecuteResponse(deletedCount: 0);
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Analyze'));
    await tester.pumpAndSettle();

    expect(find.text('Preview failed'), findsOneWidget);
    expect(find.text('Analyze'), findsOneWidget);
  });
}
