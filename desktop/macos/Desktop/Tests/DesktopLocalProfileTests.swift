import Foundation
import OmiSupport
import XCTest

final class DesktopLocalProfileTests: XCTestCase {
  func testNamedDevelopmentBundleUsesDedicatedStorageRoot() {
    XCTAssertEqual(
      DesktopStorageIdentity(
        bundleIdentifier: "com.omi.omi-memory-atlas-types",
        localProfileEnabled: false,
        localProfileStorageName: nil
      ).applicationSupportPathComponents,
      ["Omi Dev Bundles", "com.omi.omi-memory-atlas-types"]
    )
  }

  func testProductionAndDefaultDevBundleKeepSharedStorageRoot() {
    for bundleIdentifier in ["com.omi.computer-macos", "com.omi.desktop-dev"] {
      XCTAssertEqual(
        DesktopStorageIdentity(
          bundleIdentifier: bundleIdentifier,
          localProfileEnabled: false,
          localProfileStorageName: nil
        ).applicationSupportPathComponents,
        ["Omi"]
      )
    }
  }

  func testNamedDevelopmentBundleTakesPrecedenceOverLocalProfileStorage() {
    XCTAssertEqual(
      DesktopStorageIdentity(
        bundleIdentifier: "com.omi.omi-memory-atlas-types",
        localProfileEnabled: true,
        localProfileStorageName: "Omi-local-test"
      ).applicationSupportPathComponents,
      ["Omi Dev Bundles", "com.omi.omi-memory-atlas-types"]
    )
  }

  // MARK: - Local-dev onboarding bypass (contracts/parity/local_dev_onboarding_bypass.json)

  func testOnboardingBypassRequiresBothHarnessModeAndTheSeparateBypassValue() {
    // local_dev_no_flag / local_dev_flag_explicit_off / local_dev_flag_on
    XCTAssertFalse(
      DesktopLocalProfile.onboardingBypassEnabled(
        bundleIdentifier: "com.omi.desktop-dev", profileValue: "1", bypassValue: nil))
    XCTAssertFalse(
      DesktopLocalProfile.onboardingBypassEnabled(
        bundleIdentifier: "com.omi.desktop-dev", profileValue: "1", bypassValue: "0"))
    XCTAssertTrue(
      DesktopLocalProfile.onboardingBypassEnabled(
        bundleIdentifier: "com.omi.desktop-dev", profileValue: "1", bypassValue: "1"))
  }

  func testOnboardingBypassRefusesWithoutHarnessModeEvenIfTheFlagIsOn() {
    // production_flag_on_is_still_refused, and harness mode itself off.
    XCTAssertFalse(
      DesktopLocalProfile.onboardingBypassEnabled(
        bundleIdentifier: "com.omi.desktop-dev", profileValue: nil, bypassValue: "1"))
  }

  func testOnboardingBypassRefusesOnAnyProductionFamilyBundleRegardlessOfFlags() {
    for bundleIdentifier in ["com.omi.computer-macos", "com.omi.computer-macos.beta"] {
      XCTAssertFalse(
        DesktopLocalProfile.onboardingBypassEnabled(
          bundleIdentifier: bundleIdentifier, profileValue: "1", bypassValue: "1"))
    }
  }

  func testOnboardingBypassRejectsMalformedFlagValues() {
    for malformed in ["yes", "  1  ", "true", ""] {
      XCTAssertFalse(
        DesktopLocalProfile.onboardingBypassEnabled(
          bundleIdentifier: "com.omi.desktop-dev", profileValue: "1", bypassValue: malformed),
        "expected refusal for bypassValue=\(malformed.debugDescription)")
    }
  }

  func testOnboardingBypassFixtureIdentityMatchesTheSharedContract() throws {
    let fixtureURL = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // (file itself) Tests/
      .deletingLastPathComponent()  // Desktop/
      .deletingLastPathComponent()  // macos/
      .deletingLastPathComponent()  // desktop/
      .deletingLastPathComponent()  // repo root
      .appendingPathComponent("contracts/parity/local_dev_onboarding_bypass.json")
    let data = try Data(contentsOf: fixtureURL)
    let contract = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    let identity = contract?["fixture_identity"] as? [String: Any]
    XCTAssertEqual(DesktopLocalProfile.onboardingBypassFixtureUID, identity?["uid"] as? String)
    let flagNames = contract?["platform_flag_names"] as? [String: Any]
    XCTAssertEqual(flagNames?["macos"] as? String, "OMI_LOCAL_DEV_ONBOARDING_BYPASS")
  }

  func testOnboardingBypassGateCasesMatchTheSharedContract() throws {
    let fixtureURL = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("contracts/parity/local_dev_onboarding_bypass.json")
    let data = try Data(contentsOf: fixtureURL)
    let contract = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    let cases = contract?["gate_cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(cases.isEmpty)
    for gateCase in cases {
      let name = gateCase["name"] as? String ?? "<unnamed>"
      let localDevProfileActive = gateCase["local_dev_profile_active"] as? Bool ?? false
      let bypassFlagValue = gateCase["bypass_flag_value"] as? String
      let expected = gateCase["expected_bypass_active"] as? Bool ?? false
      // The shared fixture models the profile prerequisite abstractly
      // (local_dev_profile_active); this platform's concrete prerequisite is
      // harness mode on a non-production bundle, so profileValue mirrors it.
      let result = DesktopLocalProfile.onboardingBypassEnabled(
        bundleIdentifier: "com.omi.desktop-dev",
        profileValue: localDevProfileActive ? "1" : nil,
        bypassValue: bypassFlagValue)
      XCTAssertEqual(result, expected, "case: \(name)")
    }
  }
}
