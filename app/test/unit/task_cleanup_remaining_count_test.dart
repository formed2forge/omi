import 'package:flutter_test/flutter_test.dart';
import 'package:omi/pages/settings/task_cleanup_page.dart';

void main() {
  test('remaining count subtracts excluded ids from total candidates', () {
    expect(taskCleanupRemainingCount(10, {'a', 'b'}), 8);
    expect(taskCleanupRemainingCount(1, {'only'}), 0);
    expect(taskCleanupRemainingCount(5, {}), 5);
  });
}
