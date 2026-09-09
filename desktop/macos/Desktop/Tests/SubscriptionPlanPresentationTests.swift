import XCTest

@testable import Omi_Computer

final class SubscriptionPlanPresentationTests: XCTestCase {
  func testSelectionLabelIncludesTheStartingPrice() {
    XCTAssertEqual(
      SubscriptionPlanPresentation.selectionLabel(
        planTitle: "Operator", startingPrice: "$49.00/month"),
      "Select Operator · $49.00/month"
    )
  }

  func testSelectionLabelOmitsTheSeparatorWhenNoPriceIsAvailable() {
    XCTAssertEqual(
      SubscriptionPlanPresentation.selectionLabel(planTitle: "Operator", startingPrice: nil),
      "Select Operator"
    )
  }

  func testUnknownPlanUsesNeutralCopyAndNoPaidCapability() {
    let plan = SubscriptionPlanType(rawValue: "future_plan_123")

    XCTAssertEqual(plan.displayName, "Plan unavailable")
    XCTAssertFalse(plan.hasPaidCapability)
  }

  func testUnknownPlanDescriptionPointsAtSupportWithoutImplyingCancellation() {
    // The account may still be actively paying, so the copy must not suggest
    // re-subscribing: that risks a double charge.
    let description = SubscriptionPlanPresentation.currentPlanDescription(
      plan: SubscriptionPlanType(rawValue: "unknown"),
      features: [],
      currentPriceId: nil,
      catalog: []
    )

    XCTAssertEqual(
      description,
      "There may be an issue with your plan, please contact support to ensure there is no interruption in your service."
    )
  }

  func testUnknownPlanSubtitleDoesNotClaimFreeTierButRealFreeAccountStillDoes() {
    // Regression: an unknown plan (newer than this build, or the backend's own
    // unresolved sentinel) cannot prove Free entitlement, so it must not fall through
    // to the generic "no billing detail, no paid subscription" branch that claims Free.
    let unknownSubtitle = SubscriptionPlanPresentation.currentPlanSubtitle(
      isLoadingSubscription: false,
      plan: SubscriptionPlanType(rawValue: "future_plan_123"),
      billingDetail: nil,
      hasPaidSubscription: false
    )
    XCTAssertFalse(unknownSubtitle.lowercased().contains("free tier"))
    XCTAssertEqual(unknownSubtitle, SubscriptionPlanPresentation.unknownPlanSubtitle)

    // A genuinely-Free account (no unknown plan, no billing detail, no paid
    // subscription) must keep reading "free tier" — the fix must not touch this path.
    let freeSubtitle = SubscriptionPlanPresentation.currentPlanSubtitle(
      isLoadingSubscription: false,
      plan: .basic,
      billingDetail: nil,
      hasPaidSubscription: false
    )
    XCTAssertTrue(freeSubtitle.lowercased().contains("free tier"))
  }

  func testCurrentPlanSubtitlePrefersLoadingThenBillingDetailThenPaidStateOverUnknownFallback() {
    // Loading still wins over everything, including an unknown plan.
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanSubtitle(
        isLoadingSubscription: true,
        plan: SubscriptionPlanType(rawValue: "future_plan_123"),
        billingDetail: "Pro Monthly • $20.00/month",
        hasPaidSubscription: true
      ),
      "Fetching subscription details from omi."
    )
    // A resolved paid plan with billing detail keeps showing that detail.
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanSubtitle(
        isLoadingSubscription: false,
        plan: .proV2,
        billingDetail: "Pro Monthly • $20.00/month",
        hasPaidSubscription: true
      ),
      "Pro Monthly • $20.00/month"
    )
    // A resolved paid plan with no catalog-matched billing detail still reads paid.
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanSubtitle(
        isLoadingSubscription: false,
        plan: .proV2,
        billingDetail: nil,
        hasPaidSubscription: true
      ),
      "Your paid plan is active."
    )
  }

  func testPurchasablePlansArePlusAndPro() {
    XCTAssertTrue(SubscriptionPlanPresentation.isPurchasablePlan(id: "plus"))
    XCTAssertTrue(SubscriptionPlanPresentation.isPurchasablePlan(id: "pro_v2"))
    XCTAssertFalse(SubscriptionPlanPresentation.isPurchasablePlan(id: "architect"))
    XCTAssertFalse(SubscriptionPlanPresentation.isPurchasablePlan(id: "operator"))
    XCTAssertFalse(SubscriptionPlanPresentation.isPurchasablePlan(id: "unlimited_v2"))
    XCTAssertEqual(SubscriptionPlanPresentation.purchaseOrder["plus"], 0)
    XCTAssertEqual(SubscriptionPlanPresentation.purchaseOrder["pro_v2"], 1)
  }

  func testCurrentPlanTitlePrefersCatalogMatchWhenWireSaysUnlimited() {
    let catalog = [
      Self.catalogPlan(id: "plus", title: "Plus", priceId: "price_local_plus_month"),
      Self.catalogPlan(id: "pro_v2", title: "Pro", priceId: "price_local_pro_v2_month"),
      Self.catalogPlan(id: "operator", title: "Operator", priceId: "price_local_operator_month"),
    ]

    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited,
        features: [],
        currentPriceId: "price_local_plus_month",
        catalog: catalog
      ),
      "Plus"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited,
        features: [],
        currentPriceId: "price_local_pro_v2_month",
        catalog: catalog
      ),
      "Pro"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited,
        features: [],
        currentPriceId: "price_local_operator_month",
        catalog: catalog
      ),
      "Operator (Legacy Plan)"
    )
  }

  func testCurrentPlanTitleFallsBackToNeoWhenUnlimitedHasNoCatalogMatch() {
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited,
        features: [],
        currentPriceId: "price_unknown",
        catalog: []
      ),
      "Neo (Legacy Plan)"
    )
  }

  func testCurrentPlanTitleMarksKeepUntilCancelPlansAsLegacy() {
    let catalog = [
      Self.catalogPlan(id: "unlimited", title: "Neo", priceId: "price_neo"),
      Self.catalogPlan(id: "architect", title: "Architect", priceId: "price_architect"),
      Self.catalogPlan(id: "unlimited_v2", title: "Unlimited", priceId: "price_unlimited_v2"),
    ]

    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited, features: [], currentPriceId: "price_neo", catalog: catalog),
      "Neo (Legacy Plan)"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .architect, features: [], currentPriceId: "price_architect", catalog: catalog),
      "Architect (Legacy Plan)"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimitedV2, features: [], currentPriceId: "price_unlimited_v2", catalog: catalog),
      "Unlimited (Legacy Plan)"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited, features: [], currentPriceId: "price_unlimited_v2", catalog: catalog),
      "Unlimited (Legacy Plan)"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .plus, features: [], currentPriceId: nil, catalog: []),
      "Plus"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .proV2, features: [], currentPriceId: nil, catalog: []),
      "Pro"
    )
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .basic, features: [], currentPriceId: nil, catalog: []),
      "Free"
    )
  }

  func testCurrentPlanTitleByokWinsOverCatalogMatch() {
    let catalog = [Self.catalogPlan(id: "plus", title: "Plus", priceId: "price_local_plus_month")]
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited,
        features: ["byok"],
        currentPriceId: "price_local_plus_month",
        catalog: catalog
      ),
      "Free (BYOK)"
    )
    XCTAssertFalse(
      SubscriptionPlanPresentation.isKeepUntilCancelPlan(
        plan: .unlimited,
        features: ["byok"],
        currentPriceId: "price_local_plus_month",
        catalog: catalog
      )
    )
  }

  func testCurrentPlanDescriptionIsPresentForEveryCatalogPlanIncludingNeo() {
    let neo = SubscriptionPlanOption(
      id: "unlimited",
      title: "Neo",
      description: "200 chat questions per month. Unlimited transcription. Desktop capture with Free-tier allowance.",
      prices: [
        SubscriptionPriceOption(
          id: "price_neo", title: "Monthly", description: nil, priceString: "$0.00/month")
      ]
    )

    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanDescription(
        plan: .unlimited, features: [], currentPriceId: "price_neo", catalog: [neo]),
      neo.description
    )
    XCTAssertFalse(
      SubscriptionPlanPresentation.currentPlanDescription(
        plan: .unlimited, features: [], currentPriceId: "price_unknown", catalog: []
      ).isEmpty
    )
    XCTAssertTrue(
      SubscriptionPlanPresentation.fallbackDescription(for: "unlimited").contains("200 chat")
    )
    XCTAssertFalse(SubscriptionPlanPresentation.fallbackDescription(for: "unlimited").contains("100 chat"))
    XCTAssertFalse(SubscriptionPlanPresentation.fallbackDescription(for: "basic").isEmpty)
    XCTAssertFalse(SubscriptionPlanPresentation.fallbackDescription(for: "plus").isEmpty)
    XCTAssertFalse(SubscriptionPlanPresentation.fallbackDescription(for: "pro_v2").isEmpty)
    XCTAssertFalse(SubscriptionPlanPresentation.legacySupporterNote.isEmpty)
  }

  func testNormalizedPlanIdDistinguishesUnlimitedV2FromNeo() {
    // Regression test for Defect 3's actual root cause: normalizedPlanId groups
    // raw Stripe price titles into fallback-catalog buckets. Before the fix,
    // titles containing "unlimited_v2" also matched the "unlimited" substring
    // check first, so Unlimited-v2's price collapsed into Neo's bucket.
    XCTAssertEqual(
      SubscriptionPlanPresentation.normalizedPlanId(from: "Unlimited-v2 Monthly"), "unlimited_v2")
    XCTAssertEqual(
      SubscriptionPlanPresentation.normalizedPlanId(from: "Unlimited v2 Monthly"), "unlimited_v2")
    XCTAssertEqual(SubscriptionPlanPresentation.normalizedPlanId(from: "Neo Monthly"), "unlimited")
    XCTAssertEqual(
      SubscriptionPlanPresentation.normalizedPlanId(from: "Unlimited Monthly"), "unlimited")
  }

  func testFallbackCatalogKeepsUnlimitedV2AndNeoAsSeparateEntriesWithCorrectPrices() {
    // End-to-end regression for Defect 3: build the fallback catalog the way
    // SettingsContentView.planCatalog(from:) does — grouping raw backend prices
    // by normalizedPlanId — then verify owningCatalogPlan resolves the account's
    // display fields from the price id it actually holds, not from a collapsed
    // shared bucket. Before the fix this produced one "Neo"-titled entry holding
    // both prices, so Unlimited-v2 accounts rendered Neo's title/description with
    // Unlimited-v2's own (correct) price string — exactly the reported symptom.
    let prices: [(title: String, priceId: String, priceString: String)] = [
      ("Unlimited-v2 Monthly", "price_unlimited_v2_month", "$19.00/month"),
      ("Neo Monthly", "price_neo_month", "$24.99/month"),
    ]

    let grouped = Dictionary(grouping: prices) {
      SubscriptionPlanPresentation.normalizedPlanId(from: $0.title) ?? "unknown"
    }

    XCTAssertEqual(
      Set(grouped.keys), ["unlimited_v2", "unlimited"],
      "Unlimited-v2 and Neo must land in distinct fallback-catalog buckets")
    XCTAssertEqual(grouped["unlimited_v2"]?.count, 1)
    XCTAssertEqual(grouped["unlimited"]?.count, 1)

    let catalog = grouped.map { planId, options -> SubscriptionPlanOption in
      let title = planId == "unlimited_v2" ? "Unlimited" : "Neo"
      return SubscriptionPlanOption(
        id: planId,
        title: title,
        description: nil,
        features: [],
        prices: options.map {
          SubscriptionPriceOption(
            id: $0.priceId, title: "Monthly", description: nil, priceString: $0.priceString)
        }
      )
    }

    let unlimitedV2Owner = SubscriptionPlanPresentation.owningCatalogPlan(
      currentPriceId: "price_unlimited_v2_month", catalog: catalog)
    XCTAssertEqual(unlimitedV2Owner?.title, "Unlimited")
    XCTAssertEqual(unlimitedV2Owner?.prices.first?.priceString, "$19.00/month")

    let neoOwner = SubscriptionPlanPresentation.owningCatalogPlan(
      currentPriceId: "price_neo_month", catalog: catalog)
    XCTAssertEqual(neoOwner?.title, "Neo")
    XCTAssertEqual(neoOwner?.prices.first?.priceString, "$24.99/month")

    // Wire sends the ambiguous compatibility plan=unlimited for both; currentPriceId
    // is the only reliable discriminator, and both title and price must agree.
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited, features: [], currentPriceId: "price_unlimited_v2_month",
        catalog: catalog),
      "Unlimited (Legacy Plan)")
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited, features: [], currentPriceId: "price_neo_month", catalog: catalog),
      "Neo (Legacy Plan)")
  }

  /// Decodes a real `AvailablePlanPriceOption` from JSON shaped exactly like
  /// the live harness/production backend's `/v1/payments/available-plans`
  /// response (`backend/routers/payment.py`'s `PricingOption`), not a
  /// fabricated title. Unlimited-v2's actual catalog display name is
  /// "Unlimited" (`get_paid_plan_definitions()`), so its real price title is
  /// "Unlimited Monthly" / "Unlimited Annual" — no price a real backend
  /// sends ever contains the substring "v2".
  private static func decodedPrice(title: String, planId: String, priceId: String) throws
    -> AvailablePlanPriceOption
  {
    let json = """
      {
        "id": "\(priceId)",
        "plan_id": "\(planId)",
        "title": "\(title)",
        "price_string": "$0.00/month",
        "interval": "month",
        "unit_amount": 0,
        "is_active": false
      }
      """
    return try JSONDecoder().decode(AvailablePlanPriceOption.self, from: Data(json.utf8))
  }

  func testCatalogGroupingKeyUsesWirePlanIdNotAmbiguousTitle() throws {
    // Regression for the real (not fabricated) Defect 3 root cause: with the
    // backend's actual price title ("Unlimited Monthly", no "v2" substring
    // anywhere), title-only parsing (`normalizedPlanId`) returns "unlimited"
    // (Neo's bucket) because that function intentionally maps both "neo" and
    // "unlimited" substrings to the same legacy bucket. Reading the wire's
    // own plan_id must resolve this instead of relying on title text.
    let unlimitedV2Price = try Self.decodedPrice(
      title: "Unlimited Monthly", planId: "unlimited_v2", priceId: "price_local_unlimited_v2_month")
    XCTAssertEqual(
      SubscriptionPlanPresentation.normalizedPlanId(from: unlimitedV2Price.title), "unlimited",
      "sanity check: title-only parsing is genuinely ambiguous for this real title")
    XCTAssertEqual(
      SubscriptionPlanPresentation.catalogGroupingKey(for: unlimitedV2Price), "unlimited_v2")

    let neoPrice = try Self.decodedPrice(
      title: "Neo Monthly", planId: "unlimited", priceId: "price_local_unlimited_month")
    XCTAssertEqual(SubscriptionPlanPresentation.catalogGroupingKey(for: neoPrice), "unlimited")
  }

  func testCatalogGroupingKeyDegradesToTitleParsingWhenPlanIdMissing() throws {
    // A backend that omits plan_id (schema drift / older deploy) must not
    // crash the decode; grouping degrades to the old title-parsing path,
    // which only distinguishes Unlimited-v2 when the title itself says so.
    let json = """
      {
        "id": "price_x",
        "title": "Unlimited-v2 Monthly",
        "price_string": "$19.00/month",
        "interval": "month",
        "unit_amount": 1900,
        "is_active": false
      }
      """
    let price = try JSONDecoder().decode(AvailablePlanPriceOption.self, from: Data(json.utf8))
    XCTAssertEqual(price.planId, "")
    XCTAssertEqual(SubscriptionPlanPresentation.catalogGroupingKey(for: price), "unlimited_v2")
  }

  func testPlanCatalogGroupingKeepsUnlimitedV2AndNeoDistinctWithRealisticAmbiguousTitles() throws {
    // Full pipeline regression, mirroring SettingsContentView.planCatalog(from:)
    // exactly (group by catalogGroupingKey, one SubscriptionPlanOption per
    // bucket), using the real ambiguous title text this time. Before reading
    // plan_id, this collapsed Unlimited-v2's own price into Neo's "unlimited"
    // bucket — a Neo-titled entry sharing Unlimited-v2's own price id with
    // whatever primary-catalog entry the server also sent, so
    // `owningCatalogPlan`'s `catalog.first` resolved to whichever of the two
    // same-price-id entries the merged dictionary happened to iterate first.
    let prices = [
      try Self.decodedPrice(
        title: "Unlimited Monthly", planId: "unlimited_v2", priceId: "price_local_unlimited_v2_month"),
      try Self.decodedPrice(
        title: "Unlimited Annual", planId: "unlimited_v2", priceId: "price_local_unlimited_v2_year"),
    ]

    let grouped = Dictionary(grouping: prices) {
      SubscriptionPlanPresentation.catalogGroupingKey(for: $0)
    }

    XCTAssertEqual(
      Set(grouped.keys), ["unlimited_v2"],
      "Unlimited-v2's own prices must not land in Neo's 'unlimited' bucket")
    XCTAssertEqual(grouped["unlimited_v2"]?.count, 2)

    let catalog = [
      SubscriptionPlanOption(
        id: "unlimited_v2", title: "Unlimited", features: [],
        prices: prices.map {
          SubscriptionPriceOption(id: $0.id, title: "Monthly", description: nil, priceString: "$19.00/month")
        })
    ]

    let owner = SubscriptionPlanPresentation.owningCatalogPlan(
      currentPriceId: "price_local_unlimited_v2_month", catalog: catalog)
    XCTAssertEqual(owner?.title, "Unlimited")
    XCTAssertEqual(
      SubscriptionPlanPresentation.currentPlanTitle(
        plan: .unlimited, features: [], currentPriceId: "price_local_unlimited_v2_month",
        catalog: catalog),
      "Unlimited (Legacy Plan)")
  }

  func testIsCurrentSubscriptionPlanMatchesPlusByPriceIdWhenWireSaysUnlimited() {
    let plus = Self.catalogPlan(id: "plus", title: "Plus", priceId: "price_local_plus_month")
    let pro = Self.catalogPlan(id: "pro_v2", title: "Pro", priceId: "price_local_pro_v2_month")
    let catalog = [plus, pro]

    XCTAssertTrue(
      SubscriptionPlanPresentation.isCurrentSubscriptionPlan(
        plus,
        currentPlan: .unlimited,
        currentPriceId: "price_local_plus_month",
        catalog: catalog
      )
    )
    XCTAssertFalse(
      SubscriptionPlanPresentation.isCurrentSubscriptionPlan(
        pro,
        currentPlan: .unlimited,
        currentPriceId: "price_local_plus_month",
        catalog: catalog
      )
    )
  }

  // MARK: - Subscription lapse notice

  private static func medium(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .none
    return formatter.string(from: date)
  }

  private static var testDateFormatter: DateFormatter {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .none
    return formatter
  }

  func testCancellationScheduledNoticeRendersKeepSubscriptionCopyAndAction() {
    let effectiveAt = 1_700_000_000
    let lapse = SubscriptionLapse(
      state: .cancellationScheduled, reason: .userRequested, recoveryAction: .keepSubscription,
      effectiveAt: effectiveAt)

    let dateStr = Self.medium(Date(timeIntervalSince1970: TimeInterval(effectiveAt)))
    XCTAssertEqual(
      SubscriptionPlanPresentation.lapseNoticeMessage(for: lapse, dateFormatter: Self.testDateFormatter),
      "Your plan will end on \(dateStr). You'll keep full access until then."
    )
    XCTAssertEqual(SubscriptionPlanPresentation.lapseNoticeActionLabel(for: lapse.state), "Keep My Plan")
  }

  func testCancellationScheduledNoticeWithoutDateFallsBackToNeutralCopy() {
    // No date proof — fall back to the neutral message rather than guess one, matching the
    // Flutter implementation's SubscriptionLapseNoticeCard.
    let lapse = SubscriptionLapse(
      state: .cancellationScheduled, reason: .userRequested, recoveryAction: .keepSubscription,
      effectiveAt: nil)

    XCTAssertEqual(
      SubscriptionPlanPresentation.lapseNoticeMessage(for: lapse, dateFormatter: Self.testDateFormatter),
      SubscriptionPlanPresentation.lapseAccessEndedMessage
    )
  }

  func testAccessEndedNoticeRendersNeutralCopyAndResubscribeAction() {
    let lapse = SubscriptionLapse(
      state: .accessEnded, reason: .unknown, recoveryAction: .resubscribe, effectiveAt: 1_650_000_000)

    let message = SubscriptionPlanPresentation.lapseNoticeMessage(for: lapse, dateFormatter: Self.testDateFormatter)
    XCTAssertEqual(message, "Your paid access has ended.")
    XCTAssertEqual(SubscriptionPlanPresentation.lapseNoticeActionLabel(for: lapse.state), "Resubscribe")

    // The backend's `reason` is always `unknown` here — it cannot honestly distinguish
    // cancellation from payment failure or expiration after the fact, so the copy must never
    // claim a specific cause.
    let lowered = message.lowercased()
    XCTAssertFalse(lowered.contains("cancel"))
    XCTAssertFalse(lowered.contains("payment failed"))
    XCTAssertFalse(lowered.contains("expired"))
  }

  private static func catalogPlan(id: String, title: String, priceId: String) -> SubscriptionPlanOption {
    SubscriptionPlanOption(
      id: id,
      title: title,
      prices: [
        SubscriptionPriceOption(
          id: priceId,
          title: "Monthly",
          description: nil,
          priceString: "$0.00/month"
        )
      ]
    )
  }
}
