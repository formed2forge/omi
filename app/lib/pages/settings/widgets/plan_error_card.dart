import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:omi/utils/constants.dart';
import 'package:omi/utils/l10n_extensions.dart';

/// The explicit "we have no usable plan data" card.
///
/// Two cases reach it, and they recover differently:
///
/// * [unknownPlan] false — the fetch failed outright (non-200, transport
///   failure). Retrying can genuinely fix it.
/// * [unknownPlan] true — the server returned a plan ID this build cannot
///   resolve, including the backend's `unknown` sentinel for a stored plan it
///   could not resolve either. Retrying reads the same value forever, so the
///   support action must always be visible; retry stays only as a secondary
///   affordance, never the sole path.
///
/// The unknown-plan copy deliberately never implies the subscription was
/// cancelled and never invites the user to subscribe again: the account may
/// still be actively paying, and re-subscribing would double-charge them.
class PlanErrorCard extends StatelessWidget {
  const PlanErrorCard({super.key, required this.unknownPlan, required this.onRetry, this.onContactSupport});

  final bool unknownPlan;
  final VoidCallback onRetry;

  /// Overridable only so tests can observe the action; production always opens
  /// the app's existing support destination.
  final Future<void> Function()? onContactSupport;

  static Future<void> openSupport() async {
    final Uri url = Uri.parse(supportHelpCenterUrl);
    if (await canLaunchUrl(url)) {
      try {
        await launchUrl(url, mode: LaunchMode.inAppBrowserView);
      } catch (_) {
        await launchUrl(url, mode: LaunchMode.externalApplication);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('plan_usage_error_card'),
      margin: const EdgeInsets.fromLTRB(16, 24, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1F1F25),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.l10n.unableToLoadPlans, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(
            unknownPlan ? context.l10n.planIssueContactSupport : context.l10n.somethingWentWrongTryAgain,
            style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
          ),
          const SizedBox(height: 16),
          if (unknownPlan) ...[
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                key: const Key('plan_usage_error_support_button'),
                onPressed: () => (onContactSupport ?? openSupport)(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: Colors.black,
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: Text(context.l10n.helpCenter, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              ),
            ),
            const SizedBox(height: 8),
          ],
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton(
              key: const Key('plan_usage_error_retry_button'),
              onPressed: onRetry,
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: Colors.grey.shade400),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(
                context.l10n.retry,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.grey.shade300),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
