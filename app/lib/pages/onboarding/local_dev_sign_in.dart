import 'package:flutter/material.dart';

import 'package:omi/env/env.dart';
import 'package:omi/env/environment_profile.dart';
import 'package:omi/utils/l10n_extensions.dart';

/// Selects an emulator identity without requiring community-build OAuth clients.
class LocalDevSignIn extends StatelessWidget {
  const LocalDevSignIn({super.key, required this.loading, required this.onSignIn});

  final bool loading;
  final Future<void> Function(String uid) onSignIn;

  @override
  Widget build(BuildContext context) {
    if (Env.profile != AppEnvironmentProfile.localDev) return const SizedBox.shrink();
    final label = '${context.l10n.signInButton} (${context.l10n.developer})';
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: SizedBox(
        width: double.infinity,
        height: 56,
        child: OutlinedButton(
          key: const ValueKey('local-dev-sign-in'),
          onPressed: loading
              ? null
              : () async {
                  final uid = await showDialog<String>(
                    context: context,
                    builder: (context) => _LocalDevUserDialog(title: label),
                  );
                  if (uid != null && context.mounted) await onSignIn(uid);
                },
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.white,
            side: BorderSide(color: Colors.white.withValues(alpha: 0.4)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
          ),
          child: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }
}

class _LocalDevUserDialog extends StatefulWidget {
  const _LocalDevUserDialog({required this.title});
  final String title;

  @override
  State<_LocalDevUserDialog> createState() => _LocalDevUserDialogState();
}

class _LocalDevUserDialogState extends State<_LocalDevUserDialog> {
  final _uid = TextEditingController(text: 'pricing_plus');

  @override
  void dispose() {
    _uid.dispose();
    super.dispose();
  }

  void _submit() {
    if (_uid.text.trim().isNotEmpty) Navigator.of(context).pop(_uid.text.trim());
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: TextField(
          key: const ValueKey('local-dev-user-id'),
          controller: _uid,
          autofocus: true,
          autocorrect: false,
          enableSuggestions: false,
          maxLength: 128,
          decoration: InputDecoration(labelText: context.l10n.userId),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _submit(),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(context.l10n.cancel)),
          TextButton(
            key: const ValueKey('local-dev-sign-in-submit'),
            onPressed: _uid.text.trim().isEmpty ? null : _submit,
            child: Text(context.l10n.signInButton),
          ),
        ],
      );
}
