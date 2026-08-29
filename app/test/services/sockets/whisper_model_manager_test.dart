import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:omi/services/sockets/whisper_model_manager.dart';

void main() {
  late Directory tempDir;
  const manager = WhisperModelManager();

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('whisper_model_manager_test_');
  });

  tearDown(() {
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  group('WhisperModelManager.downloadModel', () {
    test('core path: downloads to a validated file, reports progress, leaves no temp file', () async {
      final expectedBytes = List<int>.filled(WhisperModelManager.minExpectedBytes['tiny']! + 1024, 7);
      final client = MockClient((request) async {
        expect(request.url.toString(), WhisperModelManager.downloadUrlFor('tiny'));
        return http.Response.bytes(expectedBytes, 200);
      });

      final progressCalls = <int>[];
      final path = await manager.downloadModel(
        model: 'tiny',
        client: client,
        modelsDir: tempDir,
        onProgress: (received, total) => progressCalls.add(received),
      );

      expect(path, await manager.modelPath('tiny', modelsDir: tempDir));
      expect(File(path).existsSync(), isTrue);
      expect(File(path).lengthSync(), expectedBytes.length);
      expect(progressCalls, isNotEmpty);
      expect(progressCalls.last, expectedBytes.length);

      // No leftover `.part` temp file once the download completes successfully.
      final leftovers = tempDir.listSync().where((e) => e.path.endsWith('.part'));
      expect(leftovers, isEmpty);

      expect(await manager.isModelReady('tiny', modelsDir: tempDir), isTrue);
      expect(WhisperModelManager.isModelFileValid(File(path), 'tiny'), isTrue);
    });

    test(
        'error path: a truncated/incomplete transfer is rejected, not left on disk, and never '
        'clobbers a previously-downloaded valid model', () async {
      // Seed an existing valid model so we can prove a failed re-download
      // doesn't overwrite it with a corrupt file — this is the concrete bug
      // whisper_flutter_new's own downloadModel() has (it streams straight to
      // the final path with no validation or cleanup on failure).
      final finalPath = await manager.modelPath('tiny', modelsDir: tempDir);
      final goodBytes = List<int>.filled(WhisperModelManager.minExpectedBytes['tiny']! + 10, 1);
      File(finalPath)
        ..createSync(recursive: true)
        ..writeAsBytesSync(goodBytes);

      // Server claims a full-size body but the connection only delivers a
      // small fraction of it before ending — a dropped connection.
      final declaredLength = WhisperModelManager.minExpectedBytes['tiny']! + 10;
      final truncatedBytes = List<int>.filled(1024, 2);
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(Stream.fromIterable([truncatedBytes]), 200, contentLength: declaredLength);
      });

      await expectLater(
        manager.downloadModel(model: 'tiny', client: client, modelsDir: tempDir),
        throwsA(isA<WhisperModelDownloadException>()),
      );

      // No leftover `.part` temp file from the failed attempt.
      final leftovers = tempDir.listSync().where((e) => e.path.endsWith('.part'));
      expect(leftovers, isEmpty);

      // The previously-valid model file is untouched.
      expect(File(finalPath).lengthSync(), goodBytes.length);
      expect(WhisperModelManager.isModelFileValid(File(finalPath), 'tiny'), isTrue);
    });

    test('error path: a non-200 response is rejected without creating a model file', () async {
      final client = MockClient((request) async => http.Response('not found', 404));

      await expectLater(
        manager.downloadModel(model: 'tiny', client: client, modelsDir: tempDir),
        throwsA(isA<WhisperModelDownloadException>()),
      );

      expect(tempDir.listSync(), isEmpty);
      expect(await manager.isModelReady('tiny', modelsDir: tempDir), isFalse);
    });
  });

  group('WhisperModelManager.isModelFileValid', () {
    test('rejects a missing file', () {
      final file = File('${tempDir.path}/ggml-tiny.bin');
      expect(WhisperModelManager.isModelFileValid(file, 'tiny'), isFalse);
    });

    test('rejects a file smaller than the expected floor for the model', () {
      final file = File('${tempDir.path}/ggml-tiny.bin')..writeAsBytesSync(List<int>.filled(1024, 0));
      expect(WhisperModelManager.isModelFileValid(file, 'tiny'), isFalse);
    });
  });
}
