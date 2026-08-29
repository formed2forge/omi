import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Raised when a whisper.cpp model download cannot be completed or produces
/// a file that isn't safe to hand to whisper.cpp for inference.
class WhisperModelDownloadException implements Exception {
  WhisperModelDownloadException(this.message, {this.isStorageError = false, this.isCancelled = false});

  final String message;

  /// True when the failure looks like the device ran out of local storage.
  final bool isStorageError;

  /// True when the download was cancelled by the caller (not a real failure).
  final bool isCancelled;

  @override
  String toString() => message;
}

/// Downloads and manages whisper.cpp GGML model files used by
/// [package:whisper_flutter_new] for on-device transcription.
///
/// whisper_flutter_new's own `downloadModel()` (see its `lib/download_model.dart`)
/// streams straight to the final file path with no size/status validation and
/// no cleanup on failure, so a dropped connection, a cancel, or a full disk
/// leaves a truncated `ggml-*.bin` sitting at the path the app treats as "model
/// ready" — the next transcription attempt then feeds whisper.cpp a corrupt
/// file. This manager downloads to a `.part` temp file, validates the result,
/// and only atomically renames it into place on success, so a partial/corrupt
/// download can never be mistaken for a usable model.
class WhisperModelManager {
  const WhisperModelManager();

  /// Default model recommended for automatic on-device setup: the smallest
  /// officially supported whisper.cpp model (see whisper_flutter_new's README,
  /// "Supported models: tiny、base、small、medium、large-v1、large-v2"), keeping
  /// the first-run download small and fast on modest hardware.
  static const String defaultModel = 'tiny';

  static const String defaultDownloadHost = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

  /// Conservative lower bound on file size (bytes) for each supported model.
  /// Real ggml files are a bit larger; anything below this floor is treated
  /// as an incomplete/corrupt download rather than a usable model.
  static const Map<String, int> minExpectedBytes = {
    'tiny': 70 * 1024 * 1024,
    'base': 130 * 1024 * 1024,
    'small': 440 * 1024 * 1024,
    'medium': 1400 * 1024 * 1024,
    'large-v1': 2800 * 1024 * 1024,
    'large-v2': 2800 * 1024 * 1024,
  };

  static String fileNameFor(String model) => 'ggml-$model.bin';

  static String downloadUrlFor(String model, {String? downloadHost}) {
    final host = (downloadHost == null || downloadHost.isEmpty) ? defaultDownloadHost : downloadHost;
    return '$host/${fileNameFor(model)}';
  }

  /// The "models" directory under the app's application-support directory
  /// where downloaded whisper models are stored.
  Future<Directory> defaultModelsDirectory() async {
    final appDir = await getApplicationSupportDirectory();
    return Directory(p.join(appDir.path, 'models'));
  }

  Future<String> modelPath(String model, {Directory? modelsDir}) async {
    final dir = modelsDir ?? await defaultModelsDirectory();
    return p.join(dir.path, fileNameFor(model));
  }

  /// Whether [file] looks like a complete, usable model for [model] — it
  /// exists and its size is at/above the conservative floor for that model.
  /// This is what guards against a truncated/corrupt download (or a file
  /// deleted/replaced by something else) being treated as ready-to-use.
  static bool isModelFileValid(File file, String model) {
    if (!file.existsSync()) return false;
    final minBytes = minExpectedBytes[model] ?? 1024 * 1024;
    try {
      return file.lengthSync() >= minBytes;
    } catch (_) {
      return false;
    }
  }

  Future<bool> isModelReady(String model, {Directory? modelsDir}) async {
    final path = await modelPath(model, modelsDir: modelsDir);
    return isModelFileValid(File(path), model);
  }

  /// Deletes leftover `.part` temp files from downloads that were interrupted
  /// (app killed, crash) before they could be validated and renamed into place.
  Future<void> cleanupStaleTempFiles({Directory? modelsDir}) async {
    final dir = modelsDir ?? await defaultModelsDirectory();
    if (!await dir.exists()) return;
    try {
      for (final entity in dir.listSync()) {
        if (entity is File && entity.path.endsWith('.part')) {
          await _safeDelete(entity);
        }
      }
    } catch (_) {
      // Best-effort cleanup only.
    }
  }

  /// Downloads [model] using [client], streaming progress via [onProgress]
  /// (bytes received, total bytes if known from the response).
  ///
  /// Returns the final on-disk path on success. On any failure (network
  /// error, non-200 response, cancellation, disk full, or a completed
  /// transfer that doesn't pass the size sanity check) the partial file is
  /// deleted and a [WhisperModelDownloadException] is thrown — any
  /// previously-downloaded valid model at [modelPath] is left untouched.
  Future<String> downloadModel({
    required String model,
    required http.Client client,
    Directory? modelsDir,
    String? downloadHost,
    void Function(int received, int? total)? onProgress,
  }) async {
    final dir = modelsDir ?? await defaultModelsDirectory();
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }

    final finalPath = p.join(dir.path, fileNameFor(model));
    final tempFile = File('$finalPath.part');

    final url = downloadUrlFor(model, downloadHost: downloadHost);
    http.StreamedResponse response;
    try {
      response = await client.send(http.Request('GET', Uri.parse(url)));
    } on http.ClientException catch (e) {
      throw WhisperModelDownloadException('Could not reach the download server: ${e.message}');
    } on SocketException catch (e) {
      throw WhisperModelDownloadException('Network error while downloading the model: ${e.message}');
    }

    if (response.statusCode != 200) {
      throw WhisperModelDownloadException('Download failed with status ${response.statusCode}');
    }

    final contentLength = response.contentLength;
    int received = 0;
    IOSink? sink;
    try {
      sink = tempFile.openWrite();
      await response.stream.listen((chunk) {
        sink!.add(chunk);
        received += chunk.length;
        onProgress?.call(received, contentLength);
      }, cancelOnError: true).asFuture();
      await sink.flush();
    } on FileSystemException catch (e) {
      await sink?.close();
      await _safeDelete(tempFile);
      final isEnospc = e.osError?.errorCode == 28; // ENOSPC
      throw WhisperModelDownloadException(
        isEnospc ? 'Not enough storage space to download the model.' : 'Could not write the model file: ${e.message}',
        isStorageError: isEnospc,
      );
    } on http.ClientException {
      await sink?.close();
      await _safeDelete(tempFile);
      throw WhisperModelDownloadException('Download was cancelled.', isCancelled: true);
    } finally {
      await sink?.close();
    }

    final minBytes = minExpectedBytes[model] ?? 1024 * 1024;
    final sizeMismatch = contentLength != null && received != contentLength;
    if (received < minBytes || sizeMismatch) {
      await _safeDelete(tempFile);
      throw WhisperModelDownloadException(
        'Downloaded model file was incomplete or corrupt (received $received of ${contentLength ?? '?'} bytes).',
      );
    }

    final finalFile = File(finalPath);
    if (await finalFile.exists()) {
      await finalFile.delete();
    }
    await tempFile.rename(finalPath);
    return finalPath;
  }

  Future<void> _safeDelete(File f) async {
    try {
      if (await f.exists()) await f.delete();
    } catch (_) {
      // Best-effort cleanup only.
    }
  }
}
