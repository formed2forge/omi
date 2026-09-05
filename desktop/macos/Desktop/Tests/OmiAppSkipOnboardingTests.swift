import XCTest

@testable import Omi_Computer

final class OmiAppSkipOnboardingTests: XCTestCase {
  func testArgvFlagSkipsOnboarding() {
    XCTAssertTrue(
      shouldSkipOnboarding(arguments: ["--skip-onboarding"], environmentValue: nil))
  }

  func testEnvOneSkipsOnboarding() {
    XCTAssertTrue(shouldSkipOnboarding(arguments: ["omi"], environmentValue: "1"))
  }

  func testWhitespaceEnvOneSkipsOnboarding() {
    XCTAssertTrue(shouldSkipOnboarding(arguments: ["omi"], environmentValue: " 1 "))
  }

  func testEnvUnsetDoesNotSkipOnboarding() {
    XCTAssertFalse(shouldSkipOnboarding(arguments: ["omi"], environmentValue: nil))
  }

  func testEnvZeroDoesNotSkipOnboarding() {
    XCTAssertFalse(shouldSkipOnboarding(arguments: ["omi"], environmentValue: "0"))
  }
}
