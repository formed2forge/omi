import 'package:flutter_test/flutter_test.dart';
import 'package:omi/providers/auth_provider.dart';

void main() {
  test('all auth loading APIs update the state observed by sign-in controls', () {
    final provider = AuthenticationProvider(initializeListeners: false);
    addTearDown(provider.dispose);
    final observed = <bool>[];
    provider.addListener(() => observed.add(provider.loading));

    provider.setLoadingState(true);
    expect(provider.loading, isTrue);
    provider.setLoading(false);
    expect(provider.loading, isFalse);
    provider.setLoading(true);
    provider.setLoadingState(false);
    expect(observed, [true, false, true, false]);
  });
}
