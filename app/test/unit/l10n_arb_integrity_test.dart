import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// STATIC structural guard, not behavioral coverage: it inspects the ARB
/// source files directly rather than driving the app through a rendered
/// widget. Named and labelled as a tripwire deliberately — per AGENTS.md a
/// file-content assertion is not a substitute for exercising production
/// behaviour, and this failure mode has no runtime seam to exercise.
///
/// Why it is worth guarding: `memoryHistoryPartial` and
/// `tapPlusToStartRecording` were absent from all 48 non-English locales
/// (valid JSON, an ordinary missing-translation gap), and `flutter gen-l10n`
/// treats an entirely absent key as merely "untranslated" rather than
/// build-breaking. So the normal build stays green while a user-visible
/// string silently falls back to English. This test fails instead, and also
/// keeps every ARB file valid, conflict-marker-free JSON.

void main() {
  final l10nDir = Directory('lib/l10n');
  final arbFiles = l10nDir.listSync().whereType<File>().where((f) => f.path.endsWith('.arb')).toList()
    ..sort((a, b) => a.path.compareTo(b.path));

  test('lib/l10n contains the expected locale ARB files', () {
    expect(arbFiles.length, greaterThanOrEqualTo(40), reason: 'sanity check that the ARB directory is being read');
  });

  group('every ARB file is valid, conflict-marker-free JSON', () {
    for (final f in arbFiles) {
      test(f.path, () {
        final raw = f.readAsStringSync();
        for (final marker in ['<<<<<<<', '=======', '>>>>>>>']) {
          expect(raw.contains(marker), isFalse, reason: '${f.path} contains an unresolved git conflict marker');
        }
        expect(() => jsonDecode(raw), returnsNormally, reason: '${f.path} is not valid JSON');
      });
    }
  });

  group('memoryHistoryPartial and tapPlusToStartRecording are translated in every locale', () {
    late final Map<String, dynamic> englishArb;
    setUpAll(() {
      englishArb = jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync()) as Map<String, dynamic>;
    });

    for (final f in arbFiles) {
      if (f.path.endsWith('app_en.arb')) continue;
      test(f.path, () {
        final arb = jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
        for (final key in ['memoryHistoryPartial', 'tapPlusToStartRecording']) {
          expect(arb.containsKey(key), isTrue, reason: '${f.path} is missing "$key"');
          final value = arb[key] as String;
          expect(value.trim(), isNotEmpty, reason: '${f.path}["$key"] is empty');
          expect(value, isNot(equals(englishArb[key])), reason: '${f.path}["$key"] is an untranslated copy of English');
        }
      });
    }
  });
}
