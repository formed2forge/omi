import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:omi/models/subscription.dart';
import 'package:omi/utils/l10n_extensions.dart';

/// The cancellation/access-end notice on the main Plan & Usage card.
///
/// Per product decision this renders directly on the primary always-visible
/// Plan & Usage surface — never a separate dialog or buried sheet.
///
/// Two states, each with the one recovery action the backend names
/// (`models.users.SubscriptionLapseRecovery`):
///
/// * [SubscriptionLapseState.cancellationScheduled] — the user is still
///   entitled; access ends at [SubscriptionLapse.effectiveAt]. Calm, no-alarm
///   copy plus a "Keep subscription" action that reverses the cancellation.
/// * [SubscriptionLapseState.accessEnded] — paid access is over. The
///   backend's `reason` is always `unknown` here (it cannot honestly
///   distinguish cancellation / expiration / payment failure after the
///   fact — see `SubscriptionLapseReason` in backend/models/users.py), so
///   this copy is deliberately neutral about cause: it must never claim a
///   specific reason like "your payment failed" or "you cancelled". This is
///   a different message from [unknownPlan]'s `planIssueContactSupport`
///   copy, which is for a corrupted/unrecognized plan value, not a normal,
///   understood lapse — the two must never be conflated.
class SubscriptionLapseNoticeCard extends StatelessWidget {
  const SubscriptionLapseNoticeCard({
    super.key,
    required this.lapse,
    required this.onKeepSubscription,
    required this.onResubscribe,
    this.busy = false,
  });

  final SubscriptionLapse lapse;
  final VoidCallback onKeepSubscription;
  final VoidCallback onResubscribe;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final isScheduled = lapse.state == SubscriptionLapseState.cancellationScheduled;
    final dateStr = lapse.effectiveAt != null
        ? DateFormat.yMMMd().format(DateTime.fromMillisecondsSinceEpoch(lapse.effectiveAt! * 1000))
        : null;

    final String message;
    if (isScheduled) {
      // No date proof — fall back to the neutral copy rather than guess one.
      message =
          dateStr != null ? context.l10n.planLapseCancellationScheduled(dateStr) : context.l10n.planLapseAccessEnded;
    } else {
      message = context.l10n.planLapseAccessEnded;
    }

    return Container(
      key: Key(isScheduled ? 'plan_lapse_notice_cancellation_scheduled' : 'plan_lapse_notice_access_ended'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: TextStyle(fontSize: 13, color: Colors.grey.shade300, height: 1.4)),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 40,
            child: OutlinedButton(
              key: Key(isScheduled ? 'plan_lapse_keep_subscription_button' : 'plan_lapse_resubscribe_button'),
              onPressed: busy ? null : (isScheduled ? onKeepSubscription : onResubscribe),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: Text(
                isScheduled ? context.l10n.keepMyPlan : context.l10n.resubscribe,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
