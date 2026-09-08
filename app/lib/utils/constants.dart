/// Special speaker ID for Omi (must match backend OnboardingHandler.OMI_SPEAKER_ID)
const int omiSpeakerId = 99;

/// The app's support destination, already opened by the settings drawer's
/// Help Center entry. Shared so every "contact support" affordance lands on
/// the same place instead of minting new URLs.
const String supportHelpCenterUrl = 'https://help.omi.me/en/';
