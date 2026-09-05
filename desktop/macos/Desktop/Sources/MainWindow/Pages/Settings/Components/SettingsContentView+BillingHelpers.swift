import OmiTheme
import Sparkle
import SwiftUI
import UniformTypeIdentifiers
import WebKit

enum SubscriptionPlanPresentation {
  static let purchaseOrder = ["plus": 0, "pro_v2": 1]
  static let keepUntilCancelPlanIds: Set<String> = [
    "unlimited", "unlimited_v2", "operator", "architect",
  ]
  static let legacyPlanTitleSuffix = " (Legacy Plan)"
  static let legacySupporterNote =
    "Thank you for being an early supporter of omi! You can stay on your legacy plan indefinitely. Please note, though, these legacy plans are no longer being sold and cannot be chosen if you switch to another plan."

  static func isPurchasablePlan(id: String) -> Bool {
    purchaseOrder[id] != nil
  }

  static func selectionLabel(planTitle: String, startingPrice: String?) -> String {
    guard let startingPrice, !startingPrice.isEmpty else {
      return "Select \(planTitle)"
    }
    return "Select \(planTitle) · \(startingPrice)"
  }

  /// Catalog row that owns `currentPriceId`. The backend serializes Plus, Pro,
  /// and Operator as `plan=unlimited` for old-mobile compatibility; matching by
  /// price id is how Settings recovers the title the user actually bought.
  static func owningCatalogPlan(
    currentPriceId: String?,
    catalog: [SubscriptionPlanOption]
  ) -> SubscriptionPlanOption? {
    guard let currentPriceId, !currentPriceId.isEmpty else { return nil }
    return catalog.first { plan in
      plan.prices.contains { $0.id == currentPriceId }
    }
  }

  static func isKeepUntilCancelPlan(
    plan: SubscriptionPlanType,
    features: [String],
    currentPriceId: String?,
    catalog: [SubscriptionPlanOption]
  ) -> Bool {
    if features.contains("byok") {
      return false
    }
    if let owning = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog) {
      if owning.legacy == true {
        return true
      }
      return keepUntilCancelPlanIds.contains(owning.id)
    }
    return keepUntilCancelPlanIds.contains(plan.rawValue)
  }

  static func titledWithLegacySuffix(_ title: String, isLegacy: Bool) -> String {
    guard isLegacy else { return title }
    if title.hasSuffix(legacyPlanTitleSuffix) {
      return title
    }
    return title + legacyPlanTitleSuffix
  }

  static func currentPlanTitle(
    plan: SubscriptionPlanType,
    features: [String],
    currentPriceId: String?,
    catalog: [SubscriptionPlanOption]
  ) -> String {
    if features.contains("byok") {
      return "Free (BYOK)"
    }
    let baseTitle: String
    if let catalogTitle = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog)?.title
    {
      baseTitle = catalogTitle
    } else {
      switch plan {
      case .basic:
        baseTitle = "Free"
      case .plus:
        baseTitle = "Plus"
      case .proV2:
        baseTitle = "Pro"
      case .unlimited:
        baseTitle = "Neo"
      case .unlimitedV2:
        baseTitle = "Unlimited"
      case .architect, .pro:
        baseTitle = "Architect"
      case .operator:
        baseTitle = "Operator"
      case .unknown:
        baseTitle = plan.displayName
      }
    }
    return titledWithLegacySuffix(
      baseTitle,
      isLegacy: isKeepUntilCancelPlan(
        plan: plan, features: features, currentPriceId: currentPriceId, catalog: catalog)
    )
  }

  static func fallbackDescription(for planId: String) -> String {
    switch planId {
    case "basic":
      return "30 chat questions per month. 300 minutes of transcription per month, then on-device. Shared with mobile and web."
    case "plus":
      return "200 chat questions per month. 1,500 minutes of transcription per month, then on-device. Full desktop, mobile, and web access."
    case "pro_v2":
      return "1,000 chat questions per month. Full desktop, mobile, and web access."
    case "unlimited":
      return "200 chat questions per month. Unlimited transcription. Desktop capture with Free-tier allowance."
    case "unlimited_v2":
      return "Unlimited transcription — record all day."
    case "operator":
      return "500 chat questions per month. Shared with mobile and web."
    case "architect":
      return "Power-user AI for heavy agentic workflows and vibe coding."
    default:
      return ""
    }
  }

  static func currentPlanDescription(
    plan: SubscriptionPlanType,
    features: [String],
    currentPriceId: String?,
    catalog: [SubscriptionPlanOption]
  ) -> String {
    if features.contains("byok") {
      return "Your own API keys. Cloud transcription and chat still follow the Free plan."
    }
    if let owning = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog) {
      if let description = owning.description?.trimmingCharacters(in: .whitespacesAndNewlines),
        !description.isEmpty
      {
        return description
      }
      return fallbackDescription(for: owning.id)
    }
    return fallbackDescription(for: plan.rawValue)
  }

  static func currentPlanFeatures(
    plan: SubscriptionPlanType,
    currentPriceId: String?,
    catalog: [SubscriptionPlanOption],
    fallback: (String) -> [String]
  ) -> [String] {
    if let owning = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog),
      !owning.features.isEmpty
    {
      return Array(owning.features.prefix(4))
    }
    let planId = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog)?.id ?? plan.rawValue
    return Array(fallback(planId).prefix(4))
  }

  static func isCurrentSubscriptionPlan(
    _ plan: SubscriptionPlanOption,
    currentPlan: SubscriptionPlanType,
    currentPriceId: String?,
    catalog: [SubscriptionPlanOption]
  ) -> Bool {
    if let owning = owningCatalogPlan(currentPriceId: currentPriceId, catalog: catalog) {
      return owning.id == plan.id
    }
    if currentPlan == .operator && plan.id == "unlimited" {
      return true
    }
    return currentPlan.rawValue == plan.id
  }
}

extension SettingsContentView {
  var hasPaidSubscription: Bool {
    guard let subscription = userSubscription?.subscription else { return false }
    if subscription.features.contains("byok") { return false }
    return subscription.plan.hasPaidCapability && subscription.status == .active
  }

  var shouldShowPlanPurchaseOptions: Bool {
    !subscriptionPlansForDisplay.isEmpty
  }

  var subscriptionPlansForDisplay: [SubscriptionPlanOption] {
    // The server-provided catalog owns plan availability and copy. The client only
    // supplies the stable Plus/Pro display order for cards that are purchasable
    // on this surface; legacy current plans remain visible through the current-plan card.
    return
      mergedPlanCatalog
      .filter { SubscriptionPlanPresentation.isPurchasablePlan(id: $0.id) && !isCurrentSubscriptionPlan($0) }
      .sorted { lhs, rhs in
        let lhsOrder = SubscriptionPlanPresentation.purchaseOrder[lhs.id, default: Int.max]
        let rhsOrder = SubscriptionPlanPresentation.purchaseOrder[rhs.id, default: Int.max]
        if lhsOrder != rhsOrder {
          return lhsOrder < rhsOrder
        }
        return lhs.title < rhs.title
      }
  }

  var currentPlanTitle: String {
    guard let subscription = userSubscription?.subscription else {
      return isLoadingSubscription ? "Loading plan..." : "Free"
    }
    return SubscriptionPlanPresentation.currentPlanTitle(
      plan: subscription.plan,
      features: subscription.features,
      currentPriceId: subscription.currentPriceId,
      catalog: mergedPlanCatalog
    )
  }

  var currentPlanIsKeepUntilCancel: Bool {
    guard let subscription = userSubscription?.subscription else { return false }
    return SubscriptionPlanPresentation.isKeepUntilCancelPlan(
      plan: subscription.plan,
      features: subscription.features,
      currentPriceId: subscription.currentPriceId,
      catalog: mergedPlanCatalog
    )
  }

  var currentPlanDescription: String {
    guard let subscription = userSubscription?.subscription else {
      return isLoadingSubscription
        ? "" : SubscriptionPlanPresentation.fallbackDescription(for: "basic")
    }
    return SubscriptionPlanPresentation.currentPlanDescription(
      plan: subscription.plan,
      features: subscription.features,
      currentPriceId: subscription.currentPriceId,
      catalog: mergedPlanCatalog
    )
  }

  var currentPlanFeatureList: [String] {
    guard let subscription = userSubscription?.subscription else {
      return fallbackFeatures(for: "basic")
    }
    return SubscriptionPlanPresentation.currentPlanFeatures(
      plan: subscription.plan,
      currentPriceId: subscription.currentPriceId,
      catalog: mergedPlanCatalog,
      fallback: fallbackFeatures(for:)
    )
  }

  /// Returns true when the user's current Stripe price maps to a plan the
  /// backend is calling "Operator". Protects against the wire-level
  /// Operator→Unlimited remapping in `/v1/users/me/subscription`.
  func isCurrentSubscriptionOperator() -> Bool {
    SubscriptionPlanPresentation.owningCatalogPlan(
      currentPriceId: userSubscription?.subscription.currentPriceId,
      catalog: mergedPlanCatalog
    )?.title == "Operator"
  }

  var currentPlanSubtitle: String {
    if isLoadingSubscription {
      return "Fetching subscription details from omi."
    }
    if let detail = currentPlanBillingDetail {
      return detail
    }
    if hasPaidSubscription {
      return "Your paid plan is active."
    }
    return "You are currently on the free tier."
  }

  var currentPlanBillingDetail: String? {
    guard hasPaidSubscription,
      let subscription = userSubscription?.subscription,
      let currentPriceId = subscription.currentPriceId
    else {
      return nil
    }

    for plan in mergedPlanCatalog {
      if let price = plan.prices.first(where: { $0.id == currentPriceId }) {
        return "\(plan.title) \(price.title) • \(price.priceString)"
      }
    }

    return nil
  }

  var currentPlanPeriodText: String? {
    guard let subscription = userSubscription?.subscription else { return nil }
    guard hasPaidSubscription, let periodEnd = subscription.currentPeriodEnd else { return nil }
    let date = Date(timeIntervalSince1970: TimeInterval(periodEnd))
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .none
    let prefix = subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"
    return "\(prefix) on \(formatter.string(from: date))"
  }

  func planSubtitle(for planId: String) -> String? {
    switch planId {
    case "plus":
      return "200 questions per month"
    case "pro_v2":
      return "1,000 questions per month"
    case "unlimited":
      return "200 questions per month"
    case "operator":
      return "500 questions per month"
    case "architect":
      return "Power-user AI — thousands of chats + agentic automations"
    default:
      return nil
    }
  }

  func planAccentColor(for planId: String) -> Color {
    // Architect is the premium white-accent tier; Operator + legacy Unlimited
    // are the mass-market green tier.
    planId == "pro_v2" || planId == "architect" ? Ink.accent : Ink.listeningGreen
  }

  func planSummaryText(for plan: SubscriptionPlanOption) -> String {
    preferredStartingPrice(for: plan)?.priceString ?? ""
  }

  func planSelectionLabel(for plan: SubscriptionPlanOption) -> String {
    SubscriptionPlanPresentation.selectionLabel(
      planTitle: plan.title,
      startingPrice: preferredStartingPrice(for: plan)?.priceString
    )
  }

  func preferredStartingPrice(for plan: SubscriptionPlanOption) -> SubscriptionPriceOption? {
    let prices = sortedPrices(for: plan)
    if let monthly = prices.first(where: { price in
      let title = price.title.lowercased()
      return title.contains("month")
    }) {
      return monthly
    }
    return prices.first
  }

  func planEyebrow(for planId: String) -> String {
    switch planId {
    case "plus":
      return "For everyday use"
    case "pro_v2":
      return "For power users"
    case "unlimited":
      return "Starter"
    case "operator":
      return "Most popular"
    case "architect":
      return "Automation + coding"
    default:
      return "Plan"
    }
  }

  func planDescription(for planId: String) -> String {
    if let catalogDescription = mergedPlanCatalog.first(where: { $0.id == planId })?.description {
      let trimmed = catalogDescription.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty {
        return trimmed
      }
    }
    return SubscriptionPlanPresentation.fallbackDescription(for: planId)
  }

  func sortedPrices(for plan: SubscriptionPlanOption) -> [SubscriptionPriceOption] {
    plan.prices.sorted { lhs, rhs in
      let lhsIsMonthly = lhs.title.lowercased().contains("month")
      let rhsIsMonthly = rhs.title.lowercased().contains("month")
      if lhsIsMonthly != rhsIsMonthly {
        return lhsIsMonthly && !rhsIsMonthly
      }
      return lhs.title < rhs.title
    }
  }

  func isCurrentSubscriptionPlan(_ plan: SubscriptionPlanOption) -> Bool {
    guard hasPaidSubscription, let currentPlan = userSubscription?.subscription.plan else {
      return false
    }
    return SubscriptionPlanPresentation.isCurrentSubscriptionPlan(
      plan,
      currentPlan: currentPlan,
      currentPriceId: userSubscription?.subscription.currentPriceId,
      catalog: mergedPlanCatalog
    )
  }

  var mergedPlanCatalog: [SubscriptionPlanOption] {
    mergePlanCatalog(primary: userSubscription?.availablePlans ?? [], fallback: fallbackPlanCatalog)
  }

  func mergePlanCatalog(
    primary: [SubscriptionPlanOption],
    fallback: [SubscriptionPlanOption]
  ) -> [SubscriptionPlanOption] {
    SubscriptionPlanCatalogMerger.merge(primary: primary, fallback: fallback)
  }

  func fallbackFeatures(for planId: String) -> [String] {
    switch planId {
    case "plus":
      return [
        "200 chat questions per month",
        "1,500 minutes of cloud transcription, then on-device",
        "Unlimited memories and insights",
        "Shared with mobile and web",
      ]
    case "pro_v2":
      return [
        "1,000 chat questions per month",
        "Unlimited cloud transcription",
        "Unlimited memories and insights",
        "Priority desktop AI features",
      ]
    case "architect":
      return [
        "Automations and vibe coding",
        "Unlimited listening, memories, and insights",
        "Priority desktop AI features",
        "~$400 of monthly AI compute included (fair-use cap)",
      ]
    case "operator":
      return [
        "500 chat questions per month",
        "Unlimited listening and transcription",
        "Unlimited memories and insights",
        "Shared with mobile and web",
      ]
    case "unlimited":
      return [
        "200 chat questions per month",
        "Unlimited listening and transcription",
        "Unlimited memories and insights",
        "Desktop capture with Free-tier allowance",
      ]
    case "unlimited_v2":
      return [
        "Unlimited transcription",
        "Unlimited memories and insights",
        "Shared with mobile and web",
      ]
    case "basic":
      return [
        "30 chat questions per month",
        "300 minutes of cloud transcription, then on-device",
        "Unlimited memories",
        "Shared with mobile and web",
      ]
    default:
      return []
    }
  }

  func normalizedPlanId(from title: String) -> String? {
    let normalized = title.lowercased()
    // Degraded price-fallback identity only. Descriptive copy comes from
    // /v1/users/me/subscription's available_plans. Keep `pro` (Architect's
    // wire alias) distinct from the new Pro SKU (`pro_v2`, display "Pro").
    if normalized.contains("pro_v2") {
      return "pro_v2"
    }
    if normalized.contains("plus") {
      return "plus"
    }
    if normalized.contains("free") || normalized.contains("basic") {
      return "basic"
    }
    if normalized.contains("unlimited") || normalized.contains("neo") {
      return "unlimited"
    }
    if normalized.contains("operator") {
      return "operator"
    }
    if normalized.contains("architect") || normalized.contains("omi pro") {
      return "architect"
    }
    if normalized == "pro" || normalized.hasPrefix("pro ") {
      return "pro_v2"
    }
    return nil
  }

  func planCatalog(from prices: [AvailablePlanPriceOption]) -> [SubscriptionPlanOption] {
    let groupedPrices = Dictionary(grouping: prices) { price in
      normalizedPlanId(from: price.title) ?? "unknown"
    }

    return groupedPrices.compactMap { planId, options in
      guard planId != "unknown" else { return nil }

      let title: String
      switch planId {
      case "basic":
        title = "Free"
      case "plus":
        title = "Plus"
      case "pro_v2":
        title = "Pro"
      case "unlimited":
        title = "Neo"
      case "operator":
        title = "Operator"
      case "architect":
        title = "Architect"
      default:
        title = options.first?.title ?? "Plan"
      }

      let mappedPrices = options.map { option in
        SubscriptionPriceOption(
          id: option.id,
          title: option.interval.lowercased().contains("year") ? "Annual" : "Monthly",
          description: option.description,
          priceString: option.priceString
        )
      }

      return SubscriptionPlanOption(
        id: planId,
        title: title,
        features: fallbackFeatures(for: planId),
        prices: mappedPrices
      )
    }
  }

  @ViewBuilder
  func subscriptionPlanCard(_ plan: SubscriptionPlanOption) -> some View {
    let isSelected = selectedPlanIdForCheckout == plan.id
    let accent = planAccentColor(for: plan.id)
    let isCurrentPlan = isCurrentSubscriptionPlan(plan)
    let isArchitectUser =
      userSubscription?.subscription.plan == .architect
      || userSubscription?.subscription.plan == .pro
    let isDowngrade = isArchitectUser && plan.id == "unlimited"
    let canPurchase = !isCurrentPlan && !isDowngrade

    VStack(alignment: .leading, spacing: OmiSpacing.lg) {
      HStack(alignment: .top, spacing: OmiSpacing.md) {
        VStack(alignment: .leading, spacing: OmiSpacing.xs) {
          // The tint is the disc, not the word — the same measurement `SettingsStatusChip`
          // documents. These are *named system colours* on a light panel: `systemGreen` sets a
          // 10 pt bold eyebrow at ≈1.6:1 against this card and `systemBlue` at ≈2.4:1, so the
          // plan's colour was there and the plan's name could not be read. Moving the hue to a
          // 6 pt disc keeps the tier legible at a glance *and* legible as words.
          HStack(spacing: 5) {
            Circle()
              .fill(accent)
              .frame(width: 6, height: 6)
            Text((plan.eyebrow ?? planEyebrow(for: plan.id)).uppercased())
              .scaledFont(size: OmiType.micro, weight: .bold)
              .foregroundColor(Ink.secondary)
              .tracking(0.8)
          }

          Text(plan.title)
            .scaledFont(size: OmiType.heading, weight: .bold)
            .foregroundColor(Ink.primary)

          if let subtitle = plan.subtitle ?? planSubtitle(for: plan.id) {
            Text(subtitle)
              .scaledFont(size: OmiType.caption)
              .foregroundColor(Ink.secondary)
          }
        }

        Spacer()

        // Selection is carried by the tile's own fill and border, so the price does not also change
        // colour to say it. The selected branch of both of these used to tint the copy — and at
        // `accent.opacity(0.8)` on a selected card that was the faintest text on the pane, i.e. the
        // state that most wanted reading was the one hardest to read.
        VStack(alignment: .trailing, spacing: OmiSpacing.hairline) {
          Text(planSummaryText(for: plan))
            .scaledFont(size: OmiType.subheading, weight: .bold)
            .foregroundColor(Ink.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.72)

          Text("starting price")
            .scaledFont(size: OmiType.micro, weight: .medium)
            .foregroundColor(Ink.secondary)
        }
        .fixedSize(horizontal: true, vertical: false)
      }

      Text(plan.description ?? planDescription(for: plan.id))
        .scaledFont(size: OmiType.body)
        .foregroundColor(Ink.secondary)

      VStack(alignment: .leading, spacing: OmiSpacing.sm) {
        ForEach(plan.features.prefix(4), id: \.self) { feature in
          HStack(spacing: OmiSpacing.sm) {
            ZStack {
              Circle()
                .fill(accent.opacity(0.16))
                .frame(width: 18, height: 18)
              // The disc carries the tint; the mark on it is ink. A `systemGreen` glyph on a 16%
              // `systemGreen` disc is the same sub-2:1 pair the eyebrow had.
              Image(systemName: "checkmark")
                .scaledFont(size: OmiType.micro, weight: .bold)
                .foregroundColor(Ink.primary)
            }
            Text(feature)
              .scaledFont(size: OmiType.body, weight: .medium)
              .foregroundColor(Ink.secondary)
          }
        }
      }

      if isSelected && canPurchase {
        GlassSeparator()

        VStack(alignment: .leading, spacing: OmiSpacing.sm) {
          VStack(alignment: .leading, spacing: OmiSpacing.xs) {
            Button(action: {
              OmiMotion.withGated(.easeInOut(duration: 0.2)) {
                isPromoCodeExpanded.toggle()
              }
            }) {
              HStack(spacing: OmiSpacing.xs) {
                Image(systemName: "tag")
                  .scaledFont(size: OmiType.caption)
                Text("Promo code")
                  .scaledFont(size: OmiType.caption)
                Image(systemName: isPromoCodeExpanded ? "chevron.up" : "chevron.down")
                  .scaledFont(size: OmiType.micro)
              }
              .foregroundColor(Ink.secondary)
            }
            .buttonStyle(.plain)

            if isPromoCodeExpanded {
              VStack(alignment: .leading, spacing: OmiSpacing.xs) {
                TextField("Enter promo code", text: $upgradePromotionCode)
                  .settingsTextInputStyle()
                  .disabled(activeCheckoutPriceId != nil)
                  .onChange(of: upgradePromotionCode) {
                    subscriptionError = nil
                  }

                if let error = subscriptionError {
                  HStack(spacing: OmiSpacing.xxs) {
                    Image(systemName: "exclamationmark.circle")
                      .scaledFont(size: OmiType.caption)
                    Text(error)
                      .scaledFont(size: OmiType.caption)
                  }
                  .foregroundColor(SettingsInk.notice)
                }
              }
              .transition(.opacity.combined(with: .move(edge: .top)))
            }
          }

          Text("Choose billing")
            .scaledFont(size: OmiType.caption, weight: .semibold)
            .foregroundColor(Ink.secondary)

          HStack(spacing: OmiSpacing.sm) {
            ForEach(sortedPrices(for: plan)) { price in
              Button(action: {
                startCheckout(for: price.id)
              }) {
                Group {
                  if activeCheckoutPriceId == price.id {
                    ProgressView()
                      .controlSize(.small)
                      .frame(maxWidth: .infinity)
                  } else {
                    VStack(spacing: OmiSpacing.hairline) {
                      Text(price.title)
                        .scaledFont(size: OmiType.caption, weight: .bold)
                      Text(price.priceString)
                        .scaledFont(size: OmiType.caption)
                        .foregroundColor(Ink.secondary)
                    }
                    .frame(maxWidth: .infinity)
                  }
                }
              }
              .buttonStyle(OmiButtonStyle(.secondary, size: .compact))
              .disabled(activeCheckoutPriceId != nil)
            }
          }
        }
      } else if isCurrentPlan {
        HStack {
          Text("Current Plan")
            .scaledFont(size: OmiType.caption, weight: .bold)
            .foregroundColor(Ink.primary)
          Spacer()
          // The glyph keeps the tint — it is a graphical object, which is a 3:1 bar rather than a
          // 4.5:1 one — and the words next to it stop being set in a hue that cannot clear either.
          Image(systemName: "checkmark.circle.fill")
            .scaledFont(size: OmiType.caption)
            .foregroundColor(accent)
        }
        .padding(.vertical, OmiSpacing.sm)
      } else {
        Button(action: {
          selectedPlanIdForCheckout = plan.id
        }) {
          HStack {
            Text(planSelectionLabel(for: plan))
              .scaledFont(size: OmiType.caption, weight: .bold)
            Spacer()
            Image(systemName: "arrow.right")
              .scaledFont(size: OmiType.caption, weight: .bold)
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(OmiButtonStyle(.secondary, size: .compact))
      }
    }
    .padding(OmiSpacing.xxl)
    .frame(maxWidth: .infinity, alignment: .leading)
    // The tile is now the pane's *only* card here rather than content inside one, so at rest it is
    // exactly the card every other pane draws — `Ink.rowFill` behind an `Ink.separator` hairline.
    // It was `Ink.wash` behind `Ink.hairline`, which are the well and control-outline tokens: right
    // for something sitting on a card, a shade too heavy once it *is* the card.
    .background(
      RoundedRectangle(cornerRadius: SettingsGlassMetrics.cardRadius, style: .continuous)
        .fill(isSelected ? accent.opacity(0.12) : Ink.rowFill)
        .overlay(
          RoundedRectangle(cornerRadius: SettingsGlassMetrics.cardRadius, style: .continuous)
            .stroke(
              isSelected ? accent.opacity(0.85) : Ink.separator,
              lineWidth: isSelected ? 1.5 : 1)
        )
    )
    .contentShape(RoundedRectangle(cornerRadius: SettingsGlassMetrics.cardRadius, style: .continuous))
    .onTapGesture {
      guard canPurchase else { return }
      selectedPlanIdForCheckout = plan.id
    }
  }

  // MARK: - Language Helpers

  /// Whether the selected language supports auto-detect mode
  var autoDetectSupported: Bool {
    AssistantSettings.supportsAutoDetect(transcriptionLanguage)
  }

  /// Subtitle text for auto-detect toggle
  var autoDetectSubtitle: String {
    if autoDetectSupported {
      return "Automatically detect spoken language"
    } else {
      return "Not available for \(languageName(for: transcriptionLanguage))"
    }
  }

  /// Get display name for a language code
  func languageName(for code: String) -> String {
    AssistantSettings.supportedLanguages.first { $0.code == code }?.name ?? code
  }

  // MARK: - Slider Index Helpers

  // Each of these was `options.firstIndex(of: stored) ?? 0`. See
  // `SettingsControlMetrics.nearestLadderIndex` for what that `?? 0` did to a stored value the
  // slider does not offer, and why the handle now snaps to the nearest step instead. When it is only
  // an approximation, `offLadderStepNote` says so under the slider.

  var analysisDelaySliderIndex: Int {
    SettingsControlMetrics.nearestLadderIndex(of: analysisDelay, in: analysisDelayOptions)
  }

  var taskIntervalSliderIndex: Int {
    SettingsControlMetrics.nearestLadderIndex(
      of: taskExtractionInterval, in: extractionIntervalOptions)
  }

  var insightIntervalSliderIndex: Int {
    SettingsControlMetrics.nearestLadderIndex(
      of: insightExtractionInterval, in: extractionIntervalOptions)
  }

  var memoryIntervalSliderIndex: Int {
    SettingsControlMetrics.nearestLadderIndex(
      of: memoryExtractionInterval, in: extractionIntervalOptions)
  }

  // MARK: - Helpers

  func toggleMonitoring(enabled: Bool) {
    if enabled && !ProactiveAssistantsPlugin.shared.hasScreenRecordingPermission {
      permissionError = "Screen recording permission required"
      isMonitoring = false
      ScreenCaptureService.requestScreenRecordingAccessAndOpenSettings()
      return
    }

    permissionError = nil
    isToggling = true

    // Track setting change
    AnalyticsManager.shared.settingToggled(setting: "monitoring", enabled: enabled)

    if enabled {
      ProactiveAssistantsPlugin.shared.startMonitoring { success, error in
        DispatchQueue.main.async {
          isToggling = false
          if !success {
            permissionError = error ?? "Failed to start monitoring"
            isMonitoring = false
          }
        }
      }
    } else {
      ProactiveAssistantsPlugin.shared.stopMonitoring()
      isToggling = false
    }

    // Persist the setting
    AssistantSettings.shared.screenAnalysisEnabled = enabled
  }

  func startGlowPreview() {
    isPreviewRunning = true

    // Show the demo window and get its frame
    let demoWindow = GlowDemoWindow.show()
    let windowFrame = demoWindow.frame

    // Phase 1: Show focused (green) glow after a small delay
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      GlowDemoWindow.setPhase(.focused)
      OverlayService.shared.showGlow(around: windowFrame, colorMode: .focused, isPreview: true)
    }

    // Phase 2: Show distracted (red) glow
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.3) {
      GlowDemoWindow.setPhase(.distracted)
      OverlayService.shared.showGlow(around: windowFrame, colorMode: .distracted, isPreview: true)
    }

    // End preview and close demo window
    DispatchQueue.main.asyncAfter(deadline: .now() + 7.0) {
      GlowDemoWindow.close()
      isPreviewRunning = false
    }
  }

  func deleteCurrentAIProfile() {
    guard let id = aiProfileId else { return }
    Task {
      let previous = await AIUserProfileService.shared.deleteProfile(id: id)
      await MainActor.run {
        if let previous {
          aiProfileId = previous.id
          aiProfileText = previous.profileText
          aiProfileGeneratedAt = previous.generatedAt
          aiProfileDataSourcesUsed = previous.dataSourcesUsed
        } else {
          aiProfileId = nil
          aiProfileText = nil
          aiProfileGeneratedAt = nil
          aiProfileDataSourcesUsed = 0
        }
      }
    }
  }

  func regenerateAIProfile() {
    isGeneratingAIProfile = true
    Task {
      do {
        let result = try await AIUserProfileService.shared.generateProfile()
        await MainActor.run {
          aiProfileId = result.id
          aiProfileText = result.profileText
          aiProfileGeneratedAt = result.generatedAt
          aiProfileDataSourcesUsed = result.dataSourcesUsed
          isGeneratingAIProfile = false
        }
      } catch {
        log("Settings: AI profile generation failed: \(error.localizedDescription)")
        await MainActor.run {
          isGeneratingAIProfile = false
        }
      }
    }
  }

  func formatMinutes(_ minutes: Int) -> String {
    if minutes == 1 {
      return "1 minute"
    } else if minutes < 60 {
      return "\(minutes) minutes"
    } else {
      return "1 hour"
    }
  }

  func formatAnalysisDelay(_ seconds: Int) -> String {
    if seconds == 0 {
      return "Instant"
    } else if seconds < 60 {
      return "\(seconds) seconds"
    } else if seconds == 60 {
      return "1 minute"
    } else {
      return "\(seconds / 60) minutes"
    }
  }

  func formatExtractionInterval(_ seconds: Double) -> String {
    if seconds < 60 {
      return "\(Int(seconds)) seconds"
    } else if seconds < 3600 {
      let minutes = Int(seconds / 60)
      return minutes == 1 ? "1 minute" : "\(minutes) minutes"
    } else {
      let hours = Int(seconds / 3600)
      return hours == 1 ? "1 hour" : "\(hours) hours"
    }
  }

  func formatHour(_ hour: Int) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "h:00 a"
    var components = DateComponents()
    components.hour = hour
    if let date = Calendar.current.date(from: components) {
      return formatter.string(from: date)
    }
    return "\(hour):00"
  }

  // MARK: - Backend Settings

  func loadBackendSettings() {
    guard !isLoadingSettings else { return }
    isLoadingSettings = true

    // Load local transcription settings first (these are used immediately)
    transcriptionLanguage = AssistantSettings.shared.transcriptionLanguage
    transcriptionAutoDetect = AssistantSettings.shared.transcriptionAutoDetect
    vocabularyList = AssistantSettings.shared.transcriptionVocabulary
    let transcriptionVocabularyRevisionAtLoadStart =
      AssistantSettings.shared.transcriptionVocabularyRevision
    vadGateEnabled = AssistantSettings.shared.vadGateEnabled
    Task {
      do {
        // Load all settings in parallel
        async let dailySummaryTask = APIClient.shared.getDailySummarySettings()
        async let notificationsReconcile: Void = NotificationSettingsSyncCoordinator.shared.reconcile()
        async let languageTask = APIClient.shared.getUserLanguage()
        async let recordingTask = APIClient.shared.getRecordingPermission()
        async let cloudSyncTask = APIClient.shared.getPrivateCloudSync()
        async let transcriptionTask = APIClient.shared.getTranscriptionPreferences()

        // Sync assistant settings from server in parallel
        async let assistantSyncTask: () = SettingsSyncManager.shared.syncFromServer()

        let (dailySummary, _, language, recording, cloudSync, transcription, _) = try await (
          dailySummaryTask,
          notificationsReconcile,
          languageTask,
          recordingTask,
          cloudSyncTask,
          transcriptionTask,
          assistantSyncTask
        )

        await MainActor.run {
          dailySummaryEnabled = dailySummary.enabled
          dailySummaryHour = dailySummary.hour
          dailySummaryTime = SettingsControlMetrics.dailySummaryDate(
            forHour: dailySummary.hour, referenceDate: Date())
          // Local UserDefaults remain the gate. The coordinator owns GET/hydrate/retry.
          notificationsEnabled = NotificationService.areNotificationsEnabled()
          notificationFrequency = NotificationService.currentFrequencyLevel()
          userLanguage = language.language
          recordingPermissionEnabled = recording.enabled
          privateCloudSyncEnabled = cloudSync.enabled
          singleLanguageMode = transcription.singleLanguageMode
          // Do not let a GET that began before a local/PATCH mutation overwrite
          // the newer vocabulary when it finally completes.
          if AssistantSettings.shared.shouldApplyTranscriptionVocabularyHydration(
            startedAtRevision: transcriptionVocabularyRevisionAtLoadStart
          ) {
            vocabularyList = transcription.vocabulary
            AssistantSettings.shared.transcriptionVocabulary = transcription.vocabulary
          } else {
            vocabularyList = AssistantSettings.shared.transcriptionVocabulary
          }

          // Sync backend language to local if different (backend is source of truth for language)
          let normalizedLanguage = AssistantSettings.normalizeTranscriptionLanguageCode(language.language)
          if !language.language.isEmpty && normalizedLanguage != transcriptionLanguage {
            transcriptionLanguage = normalizedLanguage
            AssistantSettings.shared.transcriptionLanguage = normalizedLanguage
          }

          // Sync single language mode from backend (inverted to auto-detect)
          // Only update if we got a valid response and it differs
          let backendAutoDetect =
            !transcription.singleLanguageMode && AssistantSettings.supportsAutoDetect(normalizedLanguage)
          if backendAutoDetect != transcriptionAutoDetect {
            transcriptionAutoDetect = backendAutoDetect
            AssistantSettings.shared.transcriptionAutoDetect = backendAutoDetect
          }

          isLoadingSettings = false
          viewModel.markBackendSettingsLoaded()
        }

      } catch {
        logError("Failed to load backend settings", error: error)
        await MainActor.run {
          isLoadingSettings = false
        }
      }
    }
  }

  func loadSubscriptionInfo() {
    guard !isLoadingSubscription else { return }
    isLoadingSubscription = true
    subscriptionError = nil
    refreshPlanUsageDetails()

    Task {
      do {
        let subscription = try await APIClient.shared.getUserSubscription()
        let availablePlans = try? await APIClient.shared.getAvailablePlans()
        await MainActor.run {
          userSubscription = subscription
          subscriptionError = nil
          fallbackPlanCatalog = availablePlans.map { planCatalog(from: $0.plans) } ?? []
          if let selectedPlanIdForCheckout,
            subscription.subscription.plan.rawValue == selectedPlanIdForCheckout
          {
            self.selectedPlanIdForCheckout = nil
          }
          // Clear the sticky paywall flag whenever the subscription endpoint
          // reports a non-basic active plan. Catches the case where a paid user
          // hit the paywall once (e.g. WS connected before payment cleared
          // the trial cache) — without this they'd stay paywalled until the
          // next app restart even after their Operator/Architect plan is active.
          if subscription.subscription.plan.hasPaidCapability,
            subscription.subscription.status == .active,
            AppState.current?.isPaywalled == true
          {
            AppState.current?.isPaywalled = false
            log("Paywall: cleared sticky flag — subscription \(subscription.subscription.plan.rawValue) is active")
          }
          isLoadingSubscription = false
          viewModel.markBillingRefreshed()
        }
      } catch {
        logError("Failed to load subscription", error: error)
        await MainActor.run {
          subscriptionError = "Failed to load plan information."
          isLoadingSubscription = false
        }
      }
    }
  }

  func refreshPlanUsageDetails() {
    planUsageDetailsRequestID += 1
    let requestID = planUsageDetailsRequestID
    isLoadingChatUsage = true
    isLoadingOverage = true
    chatUsageQuota = nil
    overageInfo = nil

    Task {
      async let quota = APIClient.shared.fetchChatUsageQuota()
      async let overageInfo = fetchOverageInfoForPlanUsage()
      let (quotaValue, overageInfoValue) = await (quota, overageInfo)
      applyPlanUsageDetails(
        requestID: requestID,
        quota: quotaValue,
        overageInfo: overageInfoValue
      )
    }
  }

  func fetchOverageInfoForPlanUsage() async -> OverageInfoResponse? {
    do {
      return try await APIClient.shared.getOverageInfo()
    } catch {
      logError("Failed to load overage info", error: error)
      return nil
    }
  }

  @MainActor
  func applyPlanUsageDetails(
    requestID: Int,
    quota: APIClient.ChatUsageQuota?,
    overageInfo: OverageInfoResponse?
  ) {
    guard requestID == planUsageDetailsRequestID else { return }
    chatUsageQuota = quota
    if let quota {
      FloatingBarUsageLimiter.shared.applyQuota(quota)
    }
    self.overageInfo = overageInfo
    isLoadingChatUsage = false
    isLoadingOverage = false
  }

  func applySuccessfulSubscriptionRefresh(_ subscription: UserSubscriptionResponse) {
    userSubscription = subscription
    subscriptionError = nil
    pendingSubscriptionPriceId = nil
    pendingCheckoutSessionId = nil
    selectedPlanIdForCheckout = nil

    FloatingBarUsageLimiter.shared.applyPlan(
      plan: subscription.subscription.plan,
      status: subscription.subscription.status,
      desktopGrandfatherUntil: subscription.desktopGrandfatherUntil
    )

    if subscription.subscription.plan.hasPaidCapability,
      subscription.subscription.status == .active,
      AppState.current?.isPaywalled == true
    {
      AppState.current?.isPaywalled = false
      log("Paywall: cleared sticky flag — subscription \(subscription.subscription.plan.rawValue) is active")
    }

    refreshPlanUsageDetails()
  }

  func startCheckout(for priceId: String) {
    guard activeCheckoutPriceId == nil else { return }
    activeCheckoutPriceId = priceId
    pendingSubscriptionPriceId = priceId
    subscriptionError = nil

    let promotionCode = upgradePromotionCode.trimmingCharacters(in: .whitespacesAndNewlines)
    let promoToSend: String? = promotionCode.isEmpty ? nil : promotionCode

    // If user already has an active paid subscription (not canceled), use upgrade endpoint
    // to schedule the plan change at end of billing period (no double-charging)
    if hasPaidSubscription,
      let subscription = userSubscription?.subscription,
      !subscription.cancelAtPeriodEnd
    {
      Task {
        do {
          _ = try await APIClient.shared.upgradeSubscription(
            priceId: priceId, promotionCode: promoToSend)
          await MainActor.run {
            activeCheckoutPriceId = nil
            pendingSubscriptionPriceId = nil
            subscriptionError = nil
            self.upgradePromotionCode = ""
            loadSubscriptionInfo()
          }
        } catch let apiError as APIError {
          await MainActor.run {
            activeCheckoutPriceId = nil
            pendingSubscriptionPriceId = nil
            subscriptionError = apiError.detail ?? "Failed to schedule plan change."
          }
        } catch {
          logError("Failed to schedule plan change", error: error)
          await MainActor.run {
            activeCheckoutPriceId = nil
            pendingSubscriptionPriceId = nil
            subscriptionError = "Failed to schedule plan change."
          }
        }
      }
      return
    }

    Task {
      do {
        let response = try await APIClient.shared.createCheckoutSession(
          priceId: priceId, promotionCode: promoToSend)
        let apiBaseURL = await APIClient.shared.baseURL
        await MainActor.run {
          activeCheckoutPriceId = nil
          pendingCheckoutSessionId = response.sessionId
        }

        if response.status == "reactivated" {
          await MainActor.run {
            subscriptionError = nil
            pendingSubscriptionPriceId = nil
            pendingCheckoutSessionId = nil
            loadSubscriptionInfo()
          }
        } else if let urlString = response.url, let url = URL(string: urlString) {
          let normalizedBaseURL = apiBaseURL.hasSuffix("/") ? apiBaseURL : apiBaseURL + "/"
          await MainActor.run {
            activeBillingWebFlow = BillingWebFlow(
              title: "Complete Your Upgrade",
              url: url,
              completionURLs: [
                normalizedBaseURL + "v1/payments/success",
                normalizedBaseURL + "v1/payments/cancel",
              ]
            )
          }
        } else {
          await MainActor.run {
            subscriptionError = response.message ?? "Could not start checkout."
          }
        }
      } catch let apiError as APIError {
        logError("Failed to create checkout session", error: apiError)
        await MainActor.run {
          activeCheckoutPriceId = nil
          pendingSubscriptionPriceId = nil
          pendingCheckoutSessionId = nil
          subscriptionError = apiError.detail ?? "Failed to open checkout."
        }
      } catch {
        logError("Failed to create checkout session", error: error)
        await MainActor.run {
          activeCheckoutPriceId = nil
          pendingSubscriptionPriceId = nil
          pendingCheckoutSessionId = nil
          subscriptionError = "Failed to open checkout."
        }
      }
    }
  }

  func openCustomerPortal() {
    guard !isOpeningCustomerPortal else { return }
    isOpeningCustomerPortal = true
    subscriptionError = nil

    Task {
      do {
        let response = try await APIClient.shared.createCustomerPortalSession()
        await MainActor.run {
          isOpeningCustomerPortal = false
        }

        if let url = URL(string: response.url) {
          await MainActor.run {
            openURLInDefaultBrowser(url)
            subscriptionError = "Billing portal opened in your browser."
          }
        } else {
          await MainActor.run {
            subscriptionError = "Could not open billing portal."
          }
        }
      } catch {
        logError("Failed to open customer portal", error: error)
        await MainActor.run {
          isOpeningCustomerPortal = false
          subscriptionError = "Failed to open billing portal."
        }
      }
    }
  }

  func handleBillingFlowCompletion(_ outcome: BillingWebFlowOutcome) {
    switch outcome {
    case .completed:
      Task {
        await completeLocalTestSubscriptionIfNeeded()
        await MainActor.run {
          pollForUpdatedSubscription()
        }
      }
    case .cancelled, .dismissed:
      pendingSubscriptionPriceId = nil
      pendingCheckoutSessionId = nil
      loadSubscriptionInfo()
    }
  }

  func pollForUpdatedSubscription() {
    let expectedPriceId = pendingSubscriptionPriceId

    Task {
      for attempt in 0..<8 {
        do {
          let subscription = try await APIClient.shared.getUserSubscription()
          let matchedPrice =
            expectedPriceId == nil || subscription.subscription.currentPriceId == expectedPriceId
          let hasPaidPlan =
            subscription.subscription.plan.hasPaidCapability && subscription.subscription.status == .active

          if matchedPrice && hasPaidPlan {
            await MainActor.run {
              applySuccessfulSubscriptionRefresh(subscription)
            }
            return
          }

          if attempt == 7 {
            await MainActor.run {
              userSubscription = subscription
              subscriptionError =
                "Payment completed, but plan refresh is still catching up. Please try reloading this page in a moment."
              pendingSubscriptionPriceId = nil
              pendingCheckoutSessionId = nil
            }
            return
          }

          try await Task.sleep(nanoseconds: 1_000_000_000)
        } catch {
          if attempt == 7 {
            await MainActor.run {
              subscriptionError = "Payment completed, but subscription refresh failed."
              pendingSubscriptionPriceId = nil
              pendingCheckoutSessionId = nil
            }
            return
          }

          try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
      }
    }
  }

  func completeLocalTestSubscriptionIfNeeded() async {
    guard let expectedPriceId = pendingSubscriptionPriceId else { return }
    let checkoutSessionId = pendingCheckoutSessionId
    let pythonBaseURL = await APIClient.shared.baseURL
    let rustBaseURL = await APIClient.shared.rustBackendURL

    if let checkoutSessionId, isLocalURL(pythonBaseURL) {
      guard
        let encodedSessionId = checkoutSessionId.addingPercentEncoding(
          withAllowedCharacters: .urlQueryAllowed),
        let url = URL(string: "\(pythonBaseURL)v1/payments/success?session_id=\(encodedSessionId)")
      else {
        return
      }

      do {
        _ = try await URLSession.shared.data(from: url)
      } catch {
        logError("Failed to complete local python test subscription", error: error)
      }
      return
    }

    guard isLocalURL(rustBaseURL) else { return }

    guard
      let encodedPriceId = expectedPriceId.addingPercentEncoding(
        withAllowedCharacters: .urlQueryAllowed)
    else {
      return
    }

    var urlString = "\(rustBaseURL)test/complete-subscription?price_id=\(encodedPriceId)"
    if let checkoutSessionId,
      let encodedSessionId = checkoutSessionId.addingPercentEncoding(
        withAllowedCharacters: .urlQueryAllowed)
    {
      urlString += "&session_id=\(encodedSessionId)"
    }

    guard let url = URL(string: urlString) else { return }

    do {
      _ = try await URLSession.shared.data(from: url)
    } catch {
      logError("Failed to complete local test subscription", error: error)
    }
  }

  func isLocalURL(_ url: String) -> Bool {
    url.hasPrefix("http://127.0.0.1:") || url.hasPrefix("http://localhost:")
  }

}
