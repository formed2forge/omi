import XCTest

@testable import Omi_Computer

final class SubscriptionInfoDecoderTests: XCTestCase {

  // MARK: - Baseline decoding (no deprecation fields)

  func testDecodeBasicSubscription() throws {
    let json = """
      {
        "plan": "basic",
        "status": "active",
        "current_period_end": null,
        "stripe_subscription_id": null,
        "current_price_id": null,
        "features": [],
        "cancel_at_period_end": false,
        "limits": {
          "transcription_seconds": 3600,
          "words_transcribed": 10000,
          "insights_gained": 50,
          "memories_created": 100
        }
      }
      """
    let info = try JSONDecoder().decode(UserSubscriptionInfo.self, from: json.data(using: .utf8)!)
    XCTAssertEqual(info.plan, .basic)
    XCTAssertEqual(info.status, .active)
    XCTAssertNil(info.deprecated)
    XCTAssertNil(info.deprecationMessage)
  }

  func testDecodeOperatorPlan() throws {
    let json = """
      {
        "plan": "operator",
        "status": "active",
        "current_period_end": 1700000000,
        "stripe_subscription_id": "sub_abc",
        "current_price_id": "price_xyz",
        "features": ["chat_500"],
        "cancel_at_period_end": false,
        "limits": {
          "transcription_seconds": null,
          "words_transcribed": null,
          "insights_gained": null,
          "memories_created": null
        }
      }
      """
    let info = try JSONDecoder().decode(UserSubscriptionInfo.self, from: json.data(using: .utf8)!)
    XCTAssertEqual(info.plan, .operator)
    XCTAssertEqual(info.status, .active)
    XCTAssertNil(info.deprecated)
  }

  // MARK: - Deprecation fields

  func testDecodeDeprecatedUnlimited() throws {
    let json = """
      {
        "plan": "unlimited",
        "status": "active",
        "current_period_end": 1700000000,
        "stripe_subscription_id": "sub_old",
        "current_price_id": "price_old",
        "features": ["chat_500"],
        "cancel_at_period_end": false,
        "limits": {
          "transcription_seconds": null,
          "words_transcribed": null,
          "insights_gained": null,
          "memories_created": null
        },
        "deprecated": true,
        "deprecation_message": "Your Unlimited plan is being retired. Try the Operator plan."
      }
      """
    let info = try JSONDecoder().decode(UserSubscriptionInfo.self, from: json.data(using: .utf8)!)
    XCTAssertEqual(info.plan, .unlimited)
    XCTAssertEqual(info.deprecated, true)
    XCTAssertEqual(
      info.deprecationMessage, "Your Unlimited plan is being retired. Try the Operator plan.")
  }

  func testDecodeDeprecatedFalse() throws {
    let json = """
      {
        "plan": "operator",
        "status": "active",
        "current_period_end": 1700000000,
        "stripe_subscription_id": "sub_new",
        "current_price_id": "price_new",
        "features": [],
        "cancel_at_period_end": false,
        "limits": {
          "transcription_seconds": null,
          "words_transcribed": null,
          "insights_gained": null,
          "memories_created": null
        },
        "deprecated": false
      }
      """
    let info = try JSONDecoder().decode(UserSubscriptionInfo.self, from: json.data(using: .utf8)!)
    XCTAssertEqual(info.deprecated, false)
    XCTAssertNil(info.deprecationMessage)
  }

  func testDecodeArchitectPlan() throws {
    let json = """
      {
        "plan": "architect",
        "status": "active",
        "current_period_end": 1700000000,
        "stripe_subscription_id": "sub_architect",
        "current_price_id": "price_architect",
        "features": ["automations"],
        "cancel_at_period_end": true,
        "limits": {
          "transcription_seconds": null,
          "words_transcribed": null,
          "insights_gained": null,
          "memories_created": null
        }
      }
      """
    let info = try JSONDecoder().decode(UserSubscriptionInfo.self, from: json.data(using: .utf8)!)
    XCTAssertEqual(info.plan, .architect)
    XCTAssertTrue(info.cancelAtPeriodEnd)
    XCTAssertNil(info.deprecated)
  }

  func testDecodeProPlanBackwardCompat() throws {
    let json = """
      {
        "plan": "pro",
        "status": "active",
        "current_period_end": 1700000000,
        "stripe_subscription_id": "sub_pro",
        "current_price_id": "price_pro",
        "features": ["automations"],
        "cancel_at_period_end": false,
        "limits": {
          "transcription_seconds": null,
          "words_transcribed": null,
          "insights_gained": null,
          "memories_created": null
        }
      }
      """
    let info = try JSONDecoder().decode(UserSubscriptionInfo.self, from: json.data(using: .utf8)!)
    XCTAssertEqual(info.plan, .pro)
  }

  func testDecodePlusPlan() throws {
    let plan = try JSONDecoder().decode(SubscriptionPlanType.self, from: Data(#""plus""#.utf8))
    XCTAssertEqual(plan, .plus)
    XCTAssertEqual(plan.rawValue, "plus")
    XCTAssertTrue(plan.hasPaidCapability)
  }

  func testDecodeProV2Plan() throws {
    let plan = try JSONDecoder().decode(SubscriptionPlanType.self, from: Data(#""pro_v2""#.utf8))
    XCTAssertEqual(plan, .proV2)
    XCTAssertEqual(plan.rawValue, "pro_v2")
    XCTAssertEqual(plan.displayName, "Pro")
    XCTAssertTrue(plan.hasPaidCapability)
  }

  func testDecodeProAliasStillResolvesToArchitectWireValue() throws {
    let plan = try JSONDecoder().decode(SubscriptionPlanType.self, from: Data(#""pro""#.utf8))
    XCTAssertEqual(plan, .pro)
    XCTAssertEqual(plan.rawValue, "pro")
    XCTAssertEqual(plan.displayName, "Architect")
    XCTAssertTrue(plan.hasPaidCapability)
  }

  func testDecodeUnlimitedV2Plan() throws {
    let plan = try JSONDecoder().decode(SubscriptionPlanType.self, from: Data(#""unlimited_v2""#.utf8))
    XCTAssertEqual(plan, .unlimitedV2)
    XCTAssertEqual(plan.rawValue, "unlimited_v2")
    XCTAssertTrue(plan.hasPaidCapability)
  }

  // MARK: - Subscription lapse (`UserSubscriptionResponse.lapse`)

  private static func subscriptionResponseJSON(lapseFragment: String?) -> String {
    let lapseField = lapseFragment.map { ",\n    \"lapse\": \($0)" } ?? ""
    return """
      {
        "subscription": {
          "plan": "basic",
          "status": "active",
          "current_period_end": 1700000000,
          "stripe_subscription_id": "sub_lapsed",
          "current_price_id": "price_plus_month",
          "features": [],
          "cancel_at_period_end": false,
          "limits": {
            "transcription_seconds": 3600,
            "words_transcribed": 10000,
            "insights_gained": 50,
            "memories_created": 100
          }
        }\(lapseField)
      }
      """
  }

  func testDecodeLapseCancellationScheduled() throws {
    let json = Self.subscriptionResponseJSON(
      lapseFragment: """
        {
          "state": "cancellation_scheduled",
          "reason": "user_requested",
          "recovery_action": "keep_subscription",
          "effective_at": 1700000000
        }
        """)
    let response = try JSONDecoder().decode(UserSubscriptionResponse.self, from: Data(json.utf8))
    XCTAssertEqual(response.lapse?.state, .cancellationScheduled)
    XCTAssertEqual(response.lapse?.reason, .userRequested)
    XCTAssertEqual(response.lapse?.recoveryAction, .keepSubscription)
    XCTAssertEqual(response.lapse?.effectiveAt, 1_700_000_000)
  }

  func testDecodeLapseAccessEnded() throws {
    let json = Self.subscriptionResponseJSON(
      lapseFragment: """
        {
          "state": "access_ended",
          "reason": "unknown",
          "recovery_action": "resubscribe",
          "effective_at": 1650000000
        }
        """)
    let response = try JSONDecoder().decode(UserSubscriptionResponse.self, from: Data(json.utf8))
    XCTAssertEqual(response.lapse?.state, .accessEnded)
    XCTAssertEqual(response.lapse?.reason, .unknown)
    XCTAssertEqual(response.lapse?.recoveryAction, .resubscribe)
  }

  func testDecodeMissingLapseDefaultsToNil() throws {
    let json = Self.subscriptionResponseJSON(lapseFragment: nil)
    let response = try JSONDecoder().decode(UserSubscriptionResponse.self, from: Data(json.utf8))
    XCTAssertNil(response.lapse)
  }

  func testDecodeUnrecognizedLapseStateDegradesToNilRatherThanThrowing() throws {
    // A future `state`/`reason`/`recovery_action` value this build doesn't know about must
    // not blank the entire Plan & Usage page — see the `try?` in
    // UserSubscriptionResponse.init(from:). Forward-compat posture, matching how
    // SubscriptionPlanType.unknown handles a future plan id.
    let json = Self.subscriptionResponseJSON(
      lapseFragment: """
        {
          "state": "some_future_state",
          "reason": "unknown",
          "recovery_action": "resubscribe",
          "effective_at": null
        }
        """)
    let response = try JSONDecoder().decode(UserSubscriptionResponse.self, from: Data(json.utf8))
    XCTAssertNil(response.lapse)
  }

  func testNullLapseCoexistsWithUnknownPlanSentinelWithoutEitherImplyingTheOther() throws {
    // The unknown-plan sentinel (a plan value this client doesn't recognize) and `lapse` are
    // independent fields from different backend computations
    // (`SubscriptionPlanType` decode vs. `resolve_subscription_lapse`) — a response can carry
    // the unknown-plan sentinel with no lapse evidence at all, and the two must never be
    // conflated into one notice.
    let json = """
      {
        "subscription": {
          "plan": "future_plan_123",
          "status": "active",
          "current_period_end": null,
          "stripe_subscription_id": null,
          "current_price_id": null,
          "features": [],
          "cancel_at_period_end": false,
          "limits": {
            "transcription_seconds": null,
            "words_transcribed": null,
            "insights_gained": null,
            "memories_created": null
          }
        }
      }
      """
    let response = try JSONDecoder().decode(UserSubscriptionResponse.self, from: Data(json.utf8))
    guard case .unknown = response.subscription.plan else {
      return XCTFail("expected the unknown-plan sentinel")
    }
    XCTAssertNil(response.lapse)
  }

  func testDecodeUnknownPlanPreservesIdentityAndDeniesPaidCapability() throws {
    let rawValue = "future_plan_123"
    let plan = try JSONDecoder().decode(SubscriptionPlanType.self, from: Data(#""future_plan_123""#.utf8))

    guard case .unknown(let decodedRawValue) = plan else {
      return XCTFail("future plan should retain an unknown representation")
    }
    XCTAssertEqual(decodedRawValue, rawValue)
    XCTAssertEqual(plan.rawValue, rawValue)
    XCTAssertEqual(plan.displayName, "Plan unavailable")
    XCTAssertFalse(plan.hasPaidCapability)

    let encoded = try JSONEncoder().encode(plan)
    XCTAssertEqual(String(data: encoded, encoding: .utf8), #""future_plan_123""#)
  }
}
