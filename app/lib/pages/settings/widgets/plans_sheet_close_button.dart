import 'package:flutter/material.dart';

import 'package:omi/utils/l10n_extensions.dart';

/// Discoverable, accessible close affordance for [PlansSheet].
///
/// Before this, the sheet's only dismissal paths were implicit: dragging the
/// [DraggableScrollableSheet] down to its `minChildSize` (which pops the
/// modal route via Flutter's `shouldCloseOnMinExtent` notification), or
/// tapping the sliver of modal barrier left above the sheet. Neither is
/// discoverable — there was no visible affordance beyond a decorative drag
/// handle — and neither is exposed to assistive tech or UI automation, so a
/// screen-reader user (or a test driving the app) had no way to leave the
/// sheet short of a hot restart.
///
/// Pinned via [Positioned] outside the sheet's scrollable content so it stays
/// reachable regardless of scroll offset, and carries both a real
/// [Key] (for UI automation / widget tests) and a localized [IconButton.tooltip]
/// (which becomes the button's screen-reader semantic label).
class PlansSheetCloseButton extends StatelessWidget {
  const PlansSheetCloseButton({super.key});

  static const Key buttonKey = ValueKey('plans_sheet_close_button');

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: 8,
      right: 8,
      child: SafeArea(
        bottom: false,
        child: IconButton(
          key: buttonKey,
          tooltip: context.l10n.close,
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: () {
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            }
          },
        ),
      ),
    );
  }
}
