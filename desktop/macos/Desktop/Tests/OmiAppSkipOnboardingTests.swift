import XCTest

@testable import Omi_Computer

final class OmiAppSkipOnboardingTests: XCTestCase {
  func testArgvFlagSkipsOnboarding() {
    XCTAssertTrue(
      shouldSkipOnboarding(
        arguments: ["--skip-onboarding"], environmentValue: nil, localDevOnboardingBypassEnabled: false))
  }

  func testEnvOneSkipsOnboarding() {
    XCTAssertTrue(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: "1", localDevOnboardingBypassEnabled: false))
  }

  func testWhitespaceEnvOneSkipsOnboarding() {
    XCTAssertTrue(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: " 1 ", localDevOnboardingBypassEnabled: false))
  }

  func testEnvUnsetDoesNotSkipOnboarding() {
    XCTAssertFalse(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: nil, localDevOnboardingBypassEnabled: false))
  }

  func testEnvZeroDoesNotSkipOnboarding() {
    XCTAssertFalse(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: "0", localDevOnboardingBypassEnabled: false))
  }

  // MARK: - Local-dev onboarding bypass composition (contracts/parity/local_dev_onboarding_bypass.json)

  func testOnboardingBypassAloneSkipsOnboardingWithNoArgvOrEnvFlag() {
    XCTAssertTrue(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: nil, localDevOnboardingBypassEnabled: true))
  }

  func testOnboardingBypassDisabledLeavesTheOtherTwoTriggersUnaffected() {
    // Disabling the bypass (localDevOnboardingBypassEnabled: false) must not
    // suppress the pre-existing argv/env triggers — they compose, not replace.
    XCTAssertTrue(
      shouldSkipOnboarding(
        arguments: ["--skip-onboarding"], environmentValue: nil, localDevOnboardingBypassEnabled: false))
    XCTAssertTrue(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: "1", localDevOnboardingBypassEnabled: false))
    XCTAssertFalse(
      shouldSkipOnboarding(arguments: ["omi"], environmentValue: nil, localDevOnboardingBypassEnabled: false))
  }
}
