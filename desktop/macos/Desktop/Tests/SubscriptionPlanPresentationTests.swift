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
