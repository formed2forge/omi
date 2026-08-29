import 'package:omi/backend/preferences.dart';

/// Whether newly-captured phone audio should be pinned to [WalStatus.localOnly]
/// forever instead of ever advancing to upload/sync.
///
/// This is Core tier's product mechanism: raw audio stays local instead of
/// being written to GCS (formed2forge/handoffs/omi-pricing.md §15 — everything
/// else, transcripts/memories/insights/Firestore, is unaffected and identical
/// across every tier). The Core/Plus/Max plan catalog has not landed yet
/// (tracked in the same handoff, §24's Stage 0/Stage 1 dispatch) so this is a
/// plain dev-togglable preference today, not real plan/tier gating.
///
/// **Extension point:** once the catalog lands, replace this function's body
/// with a real plan check (e.g. `SubscriptionManager.instance.currentPlan ==
/// PlanType.core`) — no other call site should need to change; every consumer
/// of the local-only mechanism (`LocalWalSyncImpl._chunk`,
/// `LocalWalSyncImpl.finalizeCurrentSession`) calls this function rather than
/// reading the preference directly.
bool isLocalOnlyAudioRetentionEnabled() => SharedPreferencesUtil().coreTierLocalOnlyAudioEnabled;

/// Swappable bounds for how much locally-retained (never-uploaded) Core-tier
/// audio is allowed to accumulate on disk before old recordings are deleted.
///
/// Mirrors the shape of Windows' local-audio retention sweep
/// (`desktop/windows/src/main/localAudio/`, formed2forge/handoffs/omi-pricing.md
/// §20) — a plain `{maxAge, maxTotalBytes}` config object rather than a
/// hardcoded policy, so a future Core-tier settings screen (or a plan-specific
/// policy) can swap it in without changing the sweep itself.
class LocalAudioRetentionPolicy {
  /// Recordings older than this (by `Wal.timerStart`) are deleted regardless
  /// of total size. A non-positive duration disables the age-based cap.
  final Duration maxAge;

  /// Once the total on-disk size of local-only recordings exceeds this, the
  /// oldest recordings are deleted (oldest-first) until back under the cap.
  /// A value <= 0 disables the size-based cap.
  final int maxTotalBytes;

  const LocalAudioRetentionPolicy({required this.maxAge, required this.maxTotalBytes});

  /// Prototype default bounds: 30 days / 2 GB. Not a product decision — see
  /// omi-pricing.md §15's "Not yet done": exact retention numbers are still
  /// unspecified. Callers needing a different policy (tests, a future settings
  /// screen) should construct their own [LocalAudioRetentionPolicy] rather than
  /// mutating this one.
  static const LocalAudioRetentionPolicy defaultPolicy = LocalAudioRetentionPolicy(
    maxAge: Duration(days: 30),
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
  );
}

/// Outcome of one retention sweep pass, for logging/tests.
class LocalAudioRetentionSweepResult {
  final int deletedByAge;
  final int deletedBySize;
  final int bytesFreed;
  final int remainingBytes;

  const LocalAudioRetentionSweepResult({
    required this.deletedByAge,
    required this.deletedBySize,
    required this.bytesFreed,
    required this.remainingBytes,
  });

  int get totalDeleted => deletedByAge + deletedBySize;

  static const empty = LocalAudioRetentionSweepResult(
    deletedByAge: 0,
    deletedBySize: 0,
    bytesFreed: 0,
    remainingBytes: 0,
  );
}
