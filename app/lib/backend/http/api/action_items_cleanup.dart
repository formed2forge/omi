import 'dart:convert';

import 'package:omi/backend/http/shared.dart';
import 'package:omi/backend/schema/gen/action_items_folders_wire.g.dart' as wire;
import 'package:omi/env/env.dart';
import 'package:omi/utils/logger.dart';

/// Thrown when cleanup preview/execute fails; [statusCode] is set for HTTP errors.
class TaskCleanupApiException implements Exception {
  final int? statusCode;
  final String message;

  const TaskCleanupApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}

String _apiDetail(String? body, int statusCode) {
  if (body == null || body.isEmpty) {
    return 'Request failed ($statusCode)';
  }
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      final detail = decoded['detail'];
      if (detail is String && detail.isNotEmpty) return detail;
      if (detail is List && detail.isNotEmpty) {
        return detail.map((e) => e.toString()).join('; ');
      }
    }
  } catch (_) {
    // Fall through to raw body.
  }
  return body;
}

/// LLM strategies over a large task set can take 60–120 seconds server-side.
const taskCleanupPreviewTimeout = Duration(seconds: 180);

Future<wire.GeneratedCleanupPreviewResponse> taskCleanupPreview({
  required List<String> strategies,
  int ageDays = 90,
  int overdueDays = 30,
  double? similarityThreshold,
  double? llmConfidenceThreshold,
  String? scanCursor,
}) async {
  final body = <String, dynamic>{
    'strategies': strategies,
    'age_days': ageDays,
    'overdue_days': overdueDays,
  };
  if (similarityThreshold != null) {
    body['similarity_threshold'] = similarityThreshold;
  }
  if (llmConfidenceThreshold != null) {
    body['llm_confidence_threshold'] = llmConfidenceThreshold;
  }
  if (scanCursor != null) {
    body['scan_cursor'] = scanCursor;
  }

  final response = await makeApiCall(
    url: '${Env.apiBaseUrl}v1/action-items/cleanup/preview',
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
    body: jsonEncode(body),
    timeout: taskCleanupPreviewTimeout,
    retries: 0,
  );

  if (response != null && response.statusCode == 200) {
    return wire.GeneratedCleanupPreviewResponse.fromJson(
      jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>,
    );
  }

  final status = response?.statusCode;
  Logger.debug('taskCleanupPreview error $status');
  throw TaskCleanupApiException(
    _apiDetail(response != null ? utf8.decode(response.bodyBytes) : null, status ?? 0),
    statusCode: status,
  );
}

Future<wire.GeneratedCleanupExecuteResponse> taskCleanupExecute({
  required String sessionId,
  List<String> excludedIds = const [],
}) async {
  final response = await makeApiCall(
    url: '${Env.apiBaseUrl}v1/action-items/cleanup/execute',
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
    body: jsonEncode({'session_id': sessionId, 'excluded_ids': excludedIds}),
    retries: 0,
  );

  if (response != null && response.statusCode == 200) {
    return wire.GeneratedCleanupExecuteResponse.fromJson(
      jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>,
    );
  }

  final status = response?.statusCode;
  Logger.debug('taskCleanupExecute error $status');
  throw TaskCleanupApiException(
    _apiDetail(response != null ? utf8.decode(response.bodyBytes) : null, status ?? 0),
    statusCode: status,
  );
}
