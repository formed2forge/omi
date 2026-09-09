import Foundation

/// The identity-derived storage boundary for a running desktop bundle.
///
/// A regular named development build gets a separate root regardless of how it
/// was launched. This is deliberately derived from the signed bundle ID instead
/// of a launcher environment variable: macOS can reopen an installed app without
/// `run.sh`, and that relaunch must remain isolated.
package struct DesktopStorageIdentity: Equatable {
  package static let namedDevelopmentBundlePrefix = "com.omi.omi-"
  package static let productionBundleIdentifier = "com.omi.computer-macos"
  /// The separately-installable "Omi Beta" app. Kept in sync with
  /// `AppBuild.betaProductionBundleIdentifier` (asserted by a unit test); OmiSupport
  /// sits below the main target, so the literal is duplicated rather than imported.
  package static let betaProductionBundleIdentifier = "com.omi.computer-macos.beta"
  package static let productionFamilyBundleIdentifiers: Set<String> = [
    productionBundleIdentifier, betaProductionBundleIdentifier,
  ]

  package let bundleIdentifier: String?
  package let localProfileEnabled: Bool
  package let localProfileStorageName: String?

  package init(
    bundleIdentifier: String?,
    localProfileEnabled: Bool,
    localProfileStorageName: String?
  ) {
    self.bundleIdentifier = bundleIdentifier
    self.localProfileEnabled = localProfileEnabled
    self.localProfileStorageName = localProfileStorageName
  }

  package var isNamedDevelopmentBundle: Bool {
    guard let bundleIdentifier else { return false }
    guard bundleIdentifier.hasPrefix(Self.namedDevelopmentBundlePrefix) else { return false }
    let suffix = bundleIdentifier.dropFirst(Self.namedDevelopmentBundlePrefix.count)
    guard !suffix.isEmpty else { return false }
    return suffix.unicodeScalars.allSatisfy { scalar in
      switch scalar.value {
      case 48...57, 65...90, 97...122, 45, 46:
        true
      default:
        false
      }
    }
  }

  package var isBetaProductionBundle: Bool {
    bundleIdentifier == Self.betaProductionBundleIdentifier
  }

  package var usesIsolatedStorage: Bool {
    localProfileEnabled || isNamedDevelopmentBundle || isBetaProductionBundle
  }

  package var applicationSupportPathComponents: [String] {
    if let bundleIdentifier, isNamedDevelopmentBundle {
      return ["Omi Dev Bundles", bundleIdentifier]
    }
    // Omi Beta owns a separate root so a live beta and a live stable instance never
    // share one SQLite database. It deliberately does not claim the legacy shared
    // `Omi/` data (isolated ⇒ no legacy migration): beta starts fresh.
    if isBetaProductionBundle {
      return ["Omi Beta"]
    }
    if localProfileEnabled {
      return [localProfileStorageName ?? "Omi"]
    }
    return ["Omi"]
  }
}

/// Runtime switches for the harness-owned Omi Dev local profile and named
/// development bundle storage. Production, beta, and canonical Omi Dev preserve
/// their existing shared storage roots.
package enum DesktopLocalProfile {
  package static var isEnabled: Bool {
    isEnabled(bundleIdentifier: Bundle.main.bundleIdentifier, profileValue: value("OMI_DESKTOP_LOCAL_PROFILE"))
  }

  package static func isEnabled(bundleIdentifier: String?, profileValue: String?) -> Bool {
    guard !DesktopStorageIdentity.productionFamilyBundleIdentifiers.contains(bundleIdentifier ?? "") else {
      return false
    }
    return profileValue == "1"
  }

  package static var storageDirectoryName: String {
    storageIdentity.applicationSupportPathComponents.joined(separator: "/")
  }

  package static var usesIsolatedStorage: Bool { storageIdentity.usesIsolatedStorage }
  package static var isNamedDevelopmentBundle: Bool { storageIdentity.isNamedDevelopmentBundle }

  package static var storageIdentity: DesktopStorageIdentity {
    DesktopStorageIdentity(
      bundleIdentifier: Bundle.main.bundleIdentifier,
      localProfileEnabled: isEnabled,
      localProfileStorageName: nonEmpty(value("OMI_LOCAL_PROFILE_STORAGE_NAME"))
    )
  }

  package static var authEmulatorHost: String? {
    guard isEnabled else { return nil }
    return nonEmpty(value("FIREBASE_AUTH_EMULATOR_HOST"))
  }

  package static var selectedUser: String? { nonEmpty(value("OMI_LOCAL_AUTH_USER")) }
  package static var selectedEmail: String? { nonEmpty(value("OMI_LOCAL_AUTH_EMAIL")) }
  package static var selectedPassword: String? { nonEmpty(value("OMI_LOCAL_AUTH_PASSWORD")) }
  package static var selectedDisplayName: String? { nonEmpty(value("OMI_LOCAL_AUTH_DISPLAY_NAME")) }

  // MARK: - Local-dev onboarding bypass
  //
  // Cross-platform contract: contracts/parity/local_dev_onboarding_bypass.json
  // (Windows: desktop/windows/src/shared/localDevOnboardingBypass.ts, mobile:
  // app/lib/env/local_dev_onboarding_bypass.dart). One canonical, non-privileged
  // fixture identity every platform signs in as when the bypass is active — see
  // AuthService.swift's bootstrapLocalHarnessAuthIfNeeded() for the sign-in side
  // and Onboarding/SkipOnboarding.swift for the onboarding-skip composition.
  //
  // WHY A SEPARATE FLAG FROM isEnabled: harness mode (OMI_DESKTOP_LOCAL_PROFILE=1)
  // is ALSO what the existing manual OMI_LOCAL_AUTH_* named-bundle flow runs
  // under (an operator-chosen uid, e.g. pricing_plus, seeded by the launcher's
  // local-profile-env.sh), which must keep running onboarding normally so
  // testers can verify the plan catalogue post-onboarding. The bypass is a
  // SEPARATE, narrower opt-in on top of harness mode — never inferred from
  // build type, persisted state, or an existing login alone.
  package static let onboardingBypassFixtureUID = "local_dev_fixture"
  package static let onboardingBypassFixtureGivenName = "Local"
  package static let onboardingBypassFixtureFamilyName = "Dev"

  /// Deterministic gate: `isEnabled` (harness mode + non-production bundle)
  /// AND a SEPARATE exact `"1"` bypass value are both required. Any other
  /// bypass value (empty, "0", "yes", whitespace-padded) is off — no fuzzy
  /// matching. See contracts/parity/local_dev_onboarding_bypass.json's
  /// gate_cases for the full truth table.
  package static func onboardingBypassEnabled(
    bundleIdentifier: String?,
    profileValue: String?,
    bypassValue: String?
  ) -> Bool {
    isEnabled(bundleIdentifier: bundleIdentifier, profileValue: profileValue) && bypassValue == "1"
  }

  package static var onboardingBypassEnabled: Bool {
    onboardingBypassEnabled(
      bundleIdentifier: Bundle.main.bundleIdentifier,
      profileValue: value("OMI_DESKTOP_LOCAL_PROFILE"),
      bypassValue: value("OMI_LOCAL_DEV_ONBOARDING_BYPASS")
    )
  }

  package static func applicationSupportURL() -> URL {
    guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
      fatalError("Application Support directory not available on this system")
    }
    return storageIdentity.applicationSupportPathComponents.reduce(base) {
      $0.appendingPathComponent($1, isDirectory: true)
    }
  }

  package static func cachesURL() -> URL {
    guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      fatalError("Caches directory not available on this system")
    }
    return storageIdentity.applicationSupportPathComponents.reduce(base) {
      $0.appendingPathComponent($1, isDirectory: true)
    }
  }

  private static func value(_ key: String) -> String? {
    guard let raw = getenv(key), let value = String(validatingCString: raw) else { return nil }
    return value.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func nonEmpty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }
}
