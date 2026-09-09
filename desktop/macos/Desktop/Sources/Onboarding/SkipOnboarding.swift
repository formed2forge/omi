import Foundation
import OmiSupport

/// Bypass Second Brain onboarding during local/dev launches.
/// `--skip-onboarding` is the argv form. `OMI_SKIP_ONBOARDING=1` is the
/// local-harness form: `open` does not inherit the launcher shell, so the
/// named-bundle `.env` (applied via setenv) is the durable path.
///
/// `localDevOnboardingBypassEnabled` composes the local-dev onboarding bypass
/// (contracts/parity/local_dev_onboarding_bypass.json) into this SAME,
/// already-tested skip check rather than adding a second call site in
/// DesktopHomeView.swift. Unlike the two argv/env forms above (which fire
/// regardless of WHO is signed in), the bypass's onboarding-skip effect is
/// only actually reachable once the fixture identity has genuinely signed in
/// via AuthService.bootstrapLocalHarnessAuthIfNeeded() — DesktopHomeView only
/// evaluates this after `authState.isSignedIn` is already true.
func shouldSkipOnboarding(
  arguments: [String] = CommandLine.arguments,
  environmentValue: String? = skipOnboardingEnvironmentValue(),
  localDevOnboardingBypassEnabled: Bool = DesktopLocalProfile.onboardingBypassEnabled
) -> Bool {
  if arguments.contains("--skip-onboarding") {
    return true
  }
  let raw = environmentValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if raw == "1" {
    return true
  }
  return localDevOnboardingBypassEnabled
}

func skipOnboardingEnvironmentValue() -> String? {
  // getenv, not ProcessInfo: BundleEnvironment applies the bundle's .env with
  // setenv after launch, and ProcessInfo.environment is a snapshot taken at
  // first access.
  guard let cString = getenv("OMI_SKIP_ONBOARDING") else { return nil }
  return String(validatingCString: cString)
}
