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
      "Operator"
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
      "Neo"
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
