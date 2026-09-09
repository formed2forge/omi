import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// INV-UI-1 guard: usage_page.dart must not use purple/deepPurple accents.
///
/// Regression for the remaining deepPurple hits (TabBar indicator, progress
/// spinners, RefreshIndicator) after the first pass replaced only
/// Colors.purple.shade300 on metric/chart colors.
void main() {
  final usagePageSource = File('lib/pages/settings/usage_page.dart').readAsStringSync();

  test('usage_page.dart has no purple or deepPurple color literals', () {
    expect(usagePageSource, isNot(contains('deepPurple')));
    expect(usagePageSource, isNot(contains('Colors.purple')));
  });
}
