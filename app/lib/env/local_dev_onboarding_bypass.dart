import 'package:omi/backend/preferences.dart';
import 'package:omi/env/env.dart';
import 'package:omi/env/environment_profile.dart';

/// Local-dev onboarding bypass — cross-platform contract in
/// contracts/parity/local_dev_onboarding_bypass.json (Windows:
/// desktop/windows/src/shared/localDevOnboardingBypass.ts, macOS:
/// OmiSupport/DesktopLocalProfile.swift + AuthService.swift). One canonical
/// fixture identity, one gate rule, three thin platform adapters — see
/// scripts/dev-harness/PRICING_WINDOWS.md's cross-platform section (and
/// app/AGENTS.md) for the enable/disable/reset recipe.
///
/// WHY A SEPARATE FLAG FROM local_dev: [AppEnvironmentProfile.localDev] is
/// ALSO the profile the existing manual "Sign In (Developer)"
/// (LocalDevSignIn) pricing-QA flow runs under (an arbitrary typed uid, e.g.
/// pricing_plus), which must keep running onboarding normally so testers can
/// verify the plan catalogue post-onboarding. The bypass is a SEPARATE,
/// narrower opt-in on top of local_dev — never inferred from build type,
/// persisted state, or an existing login alone.

/// The single non-privileged fixture identity every platform signs in as when
/// the bypass is active. Carries no Stripe/subscription document, so it
/// resolves to Free/no-entitlement through the same path as any brand-new
/// never-subscribed account. Distinct from the pricing_* fixtures.
const String kLocalDevFixtureUid = 'local_dev_fixture';
const String kLocalDevFixtureGivenName = 'Local';
const String kLocalDevFixtureFamilyName = 'Dev';
const String kLocalDevFixtureDisplayName = 'Local Dev';

/// Deterministic gate: both the profile prerequisite AND an exact `"1"` flag
/// value are required. Any other flag value (empty, "0", "yes", whitespace-
/// padded) is treated as off — no fuzzy matching. See contracts/parity/
/// local_dev_onboarding_bypass.json's gate_cases for the full truth table.
bool resolveLocalDevOnboardingBypassActive({
  required bool localDevProfileActive,
  required String? bypassFlagValue,
}) {
  if (!localDevProfileActive) return false;
  return bypassFlagValue == '1';
}

/// Whether `uid` is the bypass's own fixture identity — used to require that
/// onboarding-skip composes with "genuinely signed in as the fixture", not
/// "any local_dev login" (e.g. a manually-typed pricing_plus session must
/// still run onboarding even while the bypass flag happens to be set).
bool isLocalDevOnboardingBypassIdentity(String? uid) => uid == kLocalDevFixtureUid;

/// Build-time-frozen (dart-define) gate — the production entry point. Tests
/// exercise [resolveLocalDevOnboardingBypassActive] directly with injected
/// values instead of reading this constant.
bool get localDevOnboardingBypassActive => resolveLocalDevOnboardingBypassActive(
      localDevProfileActive: Env.profile == AppEnvironmentProfile.localDev,
      bypassFlagValue: const String.fromEnvironment('OMI_LOCAL_DEV_ONBOARDING_BYPASS'),
    );

/// Whether the CURRENT locally-cached identity is genuinely the fixture.
/// Onboarding-gating call sites must check this (not just
/// [localDevOnboardingBypassActive]) before treating onboarding as satisfied.
bool get localDevOnboardingBypassSatisfied =>
    localDevOnboardingBypassActive && isLocalDevOnboardingBypassIdentity(SharedPreferencesUtil().uid);

/// Where [MobileApp] (app/lib/mobile/mobile_app.dart) routes a signed-in user.
enum MobileAppRoute { onboarding, permissionsGate, home }

/// Pure routing decision for a signed-in user, extracted so the bypass
/// composition (contracts/parity/local_dev_onboarding_bypass.json) is testable
/// without Provider/widget scaffolding. `bypassSatisfied` is RUNTIME-only: it
/// never persists aiConsentGiven/onboardingCompleted/permissionsCompleted, so
/// disabling the bypass and relaunching falls straight back through to the
/// real onboarding flow with no stale "completed" residue to clear, and it
/// requires the SIGNED-IN uid to match the fixture (not just that the flag is
/// set) so a tester who manually signs in as pricing_plus still onboards.
MobileAppRoute resolveMobileAppRoute({
  required bool aiConsentGiven,
  required bool onboardingCompleted,
  required bool permissionsCompleted,
  required bool bypassSatisfied,
}) {
  if (!aiConsentGiven && !bypassSatisfied) return MobileAppRoute.onboarding;
  if (onboardingCompleted || bypassSatisfied) {
    if (!permissionsCompleted && !bypassSatisfied) return MobileAppRoute.permissionsGate;
    return MobileAppRoute.home;
  }
  return MobileAppRoute.onboarding;
}
