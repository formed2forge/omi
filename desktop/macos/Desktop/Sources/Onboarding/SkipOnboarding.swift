import Foundation

/// Bypass Second Brain onboarding during local/dev launches.
/// `--skip-onboarding` is the argv form. `OMI_SKIP_ONBOARDING=1` is the
/// local-harness form: `open` does not inherit the launcher shell, so the
/// named-bundle `.env` (applied via setenv) is the durable path.
func shouldSkipOnboarding(
  arguments: [String] = CommandLine.arguments,
  environmentValue: String? = skipOnboardingEnvironmentValue()
) -> Bool {
  if arguments.contains("--skip-onboarding") {
    return true
  }
  let raw = environmentValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  return raw == "1"
}

func skipOnboardingEnvironmentValue() -> String? {
  // getenv, not ProcessInfo: BundleEnvironment applies the bundle's .env with
  // setenv after launch, and ProcessInfo.environment is a snapshot taken at
  // first access.
  guard let cString = getenv("OMI_SKIP_ONBOARDING") else { return nil }
  return String(validatingCString: cString)
}
