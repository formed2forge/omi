import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:omi/services/sockets/on_device_whisper_provider.dart';

void main() {
  group('OnDeviceWhisperProvider.transcribe model validation', () {
    late Directory tempDir;

    setUp(() {
      tempDir = Directory.systemTemp.createTempSync('on_device_whisper_provider_test_');
    });

    tearDown(() {
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    // Regression: _ensureInitialized only checked File.exists(), so a
    // truncated/corrupt model download (e.g. from an interrupted transfer)
    // would be handed straight to the whisper.cpp FFI layer instead of being
    // rejected up front.
    test('fails gracefully instead of initializing when the model file is missing', () async {
      final modelPath = '${tempDir.path}/ggml-tiny.bin';
      final provider = OnDeviceWhisperProvider(modelPath: modelPath);

      final result = await provider.transcribe(Uint8List(0));

      expect(result, isNull);
    });

    test('fails gracefully instead of initializing when the model file is truncated/corrupt', () async {
      final modelPath = '${tempDir.path}/ggml-tiny.bin';
      // Far below whisper.cpp's real ~75MB tiny model size — looks like a
      // download that was cut off partway through.
      File(modelPath).writeAsBytesSync(List<int>.filled(1024, 0));
      final provider = OnDeviceWhisperProvider(modelPath: modelPath);

      final result = await provider.transcribe(Uint8List(0));

      expect(result, isNull);
    });
  });

  group('OnDeviceWhisperProvider.buildTranscribeRequest', () {
    // Regression: transcribe()'s optional `language` parameter shadowed the
    // provider's `language` field, so the configured language was silently
    // dropped and whisper always ran with '' (auto-detect).
    test('falls back to the provider language when no per-call language is given', () {
      final provider = OnDeviceWhisperProvider(modelPath: '/models/ggml-tiny.bin', language: 'ru');

      final req = provider.buildTranscribeRequest('/tmp/audio.wav');

      expect(req.language, 'ru');
      expect(req.audio, '/tmp/audio.wav');
    });

    test('per-call language overrides the provider language', () {
      final provider = OnDeviceWhisperProvider(modelPath: '/models/ggml-tiny.bin', language: 'ru');

      final req = provider.buildTranscribeRequest('/tmp/audio.wav', language: 'de');

      expect(req.language, 'de');
    });

    test("maps 'multi' to an empty string so whisper auto-detects", () {
      final provider = OnDeviceWhisperProvider(modelPath: '/models/ggml-tiny.bin', language: 'multi');

      final req = provider.buildTranscribeRequest('/tmp/audio.wav');

      expect(req.language, '');
    });
  });
}
