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
