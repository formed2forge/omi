import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:omi/backend/http/api/action_items_cleanup.dart';
import 'package:omi/backend/schema/gen/action_items_folders_wire.g.dart' as wire;
import 'package:omi/providers/action_items_provider.dart';
import 'package:omi/utils/alerts/app_snackbar.dart';
import 'package:omi/utils/l10n_extensions.dart';
import 'package:provider/provider.dart';

enum TaskCleanupPhase { config, loading, preview, deleting }

enum TaskCleanupStrategy {
  staleAge('stale_age'),
  overdue('overdue'),
  vague('vague'),
  semanticDedup('semantic_dedup', slow: true),
  llmRelevance('llm_relevance', slow: true),
  conversationContext('conversation_context', slow: true);

  const TaskCleanupStrategy(this.id, {this.slow = false});

  final String id;
  final bool slow;
}

const defaultTaskCleanupStrategies = {
  TaskCleanupStrategy.staleAge,
  TaskCleanupStrategy.overdue,
  TaskCleanupStrategy.vague,
};

/// Selected-for-deletion count after user exclusions.
int taskCleanupRemainingCount(int totalCandidates, Set<String> excludedIds) {
  return totalCandidates - excludedIds.length;
}

class TaskCleanupPage extends StatefulWidget {
  const TaskCleanupPage({
    super.key,
    this.previewFn = taskCleanupPreview,
    this.executeFn = taskCleanupExecute,
  });

  final Future<wire.GeneratedCleanupPreviewResponse> Function({
    required List<String> strategies,
    int ageDays,
    int overdueDays,
    String? scanCursor,
  }) previewFn;

  final Future<wire.GeneratedCleanupExecuteResponse> Function({
    required String sessionId,
    List<String> excludedIds,
  }) executeFn;

  @override
  State<TaskCleanupPage> createState() => _TaskCleanupPageState();
}

class _TaskCleanupPageState extends State<TaskCleanupPage> {
  TaskCleanupPhase _phase = TaskCleanupPhase.config;
  final Set<TaskCleanupStrategy> _selected = Set<TaskCleanupStrategy>.from(defaultTaskCleanupStrategies);
  wire.GeneratedCleanupPreviewResponse? _preview;
  String? _nextScanCursor;
  String? _error;
  final Set<String> _excludedIds = {};

  bool get _hasSlow => _selected.any((s) => s.slow);

  int get _remainingCount =>
      _preview == null ? 0 : taskCleanupRemainingCount(_preview!.totalCandidates, _excludedIds);

  void _toggleStrategy(TaskCleanupStrategy strategy) {
    setState(() {
      if (_selected.contains(strategy)) {
        _selected.remove(strategy);
      } else {
        _selected.add(strategy);
      }
    });
  }

  void _toggleCandidate(String id) {
    setState(() {
      if (_excludedIds.contains(id)) {
        _excludedIds.remove(id);
      } else {
        _excludedIds.add(id);
      }
    });
  }

  Future<void> _analyze() async {
    if (_selected.isEmpty) return;
    setState(() {
      _phase = TaskCleanupPhase.loading;
      _error = null;
    });
    try {
      final result = await widget.previewFn(
        strategies: _selected.map((s) => s.id).toList(),
        scanCursor: _nextScanCursor,
      );
      if (!mounted) return;
      setState(() {
        _preview = result;
        _nextScanCursor = result.nextScanCursor;
        _excludedIds.clear();
        _phase = TaskCleanupPhase.preview;
      });
    } on TaskCleanupApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _phase = TaskCleanupPhase.config;
      });
    }
  }

  Future<void> _execute() async {
    final preview = _preview;
    if (preview == null) return;
    setState(() => _phase = TaskCleanupPhase.deleting);
    try {
      final result = await widget.executeFn(
        sessionId: preview.sessionId,
        excludedIds: _excludedIds.toList(),
      );
      if (!mounted) return;
      final count = result.deletedCount;
      AppSnackbar.showSnackbar(
        count == 1 ? context.l10n.taskCleanupDeletedOneSuccess : context.l10n.taskCleanupDeletedSuccess(count),
      );
      await context.read<ActionItemsProvider>().forceRefreshActionItems();
      if (!mounted) return;
      Navigator.of(context).pop();
    } on TaskCleanupApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 410) {
        AppSnackbar.showSnackbarError(context.l10n.taskCleanupSessionExpired);
        setState(() {
          _phase = TaskCleanupPhase.config;
          _preview = null;
          _excludedIds.clear();
        });
        return;
      }
      AppSnackbar.showSnackbarError(context.l10n.taskCleanupDeleteFailed(e.message));
      setState(() => _phase = TaskCleanupPhase.preview);
    }
  }

  void _backToConfig() {
    setState(() {
      _phase = TaskCleanupPhase.config;
      _preview = null;
      _excludedIds.clear();
    });
  }

  String _strategyLabel(BuildContext context, String strategyId) {
    final l10n = context.l10n;
    return switch (strategyId) {
      'stale_age' => l10n.taskCleanupStrategyLabelStale,
      'overdue' => l10n.taskCleanupStrategyLabelOverdue,
      'vague' => l10n.taskCleanupStrategyLabelVague,
      'semantic_dedup' => l10n.taskCleanupStrategyLabelDuplicate,
      'llm_relevance' => l10n.taskCleanupStrategyLabelAiFlagged,
      'conversation_context' => l10n.taskCleanupStrategyLabelContextStale,
      _ => strategyId,
    };
  }

  ({String title, String detail}) _strategyCopy(BuildContext context, TaskCleanupStrategy strategy) {
    final l10n = context.l10n;
    return switch (strategy) {
      TaskCleanupStrategy.staleAge => (title: l10n.taskCleanupStrategyStale, detail: l10n.taskCleanupStrategyStaleDetail),
      TaskCleanupStrategy.overdue => (title: l10n.taskCleanupStrategyOverdue, detail: l10n.taskCleanupStrategyOverdueDetail),
      TaskCleanupStrategy.vague => (title: l10n.taskCleanupStrategyVague, detail: l10n.taskCleanupStrategyVagueDetail),
      TaskCleanupStrategy.semanticDedup => (
        title: l10n.taskCleanupStrategySemanticDedup,
        detail: l10n.taskCleanupStrategySemanticDedupDetail,
      ),
      TaskCleanupStrategy.llmRelevance => (
        title: l10n.taskCleanupStrategyLlmRelevance,
        detail: l10n.taskCleanupStrategyLlmRelevanceDetail,
      ),
      TaskCleanupStrategy.conversationContext => (
        title: l10n.taskCleanupStrategyConversationContext,
        detail: l10n.taskCleanupStrategyConversationContextDetail,
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final isDeleting = _phase == TaskCleanupPhase.deleting;

    return PopScope(
      canPop: !isDeleting,
      child: Scaffold(
        backgroundColor: const Color(0xFF000000),
        appBar: AppBar(
          backgroundColor: const Color(0xFF000000),
          foregroundColor: Colors.white,
          title: Text(context.l10n.taskCleanupTitle),
          leading: isDeleting
              ? null
              : IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
        ),
        bottomNavigationBar: _buildFooter(context),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: switch (_phase) {
              TaskCleanupPhase.config => _buildConfig(context),
              TaskCleanupPhase.loading => _buildLoading(context),
              TaskCleanupPhase.preview => _buildPreview(context),
              TaskCleanupPhase.deleting => _buildDeleting(context),
            },
          ),
        ),
      ),
    );
  }

  Widget? _buildFooter(BuildContext context) {
    return switch (_phase) {
      TaskCleanupPhase.config => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(context.l10n.cancel),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _selected.isEmpty ? null : _analyze,
                  child: Text(context.l10n.taskCleanupAnalyze),
                ),
              ),
            ],
          ),
        ),
      ),
      TaskCleanupPhase.preview when _preview != null => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(onPressed: _backToConfig, child: Text(context.l10n.back)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700),
                  onPressed: _remainingCount == 0 ? null : _execute,
                  child: Text(
                    _remainingCount == 1
                        ? context.l10n.taskCleanupDeleteOneTask
                        : context.l10n.taskCleanupDeleteTasks(_remainingCount),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      TaskCleanupPhase.deleting => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              const SizedBox(width: 12),
              Text(context.l10n.taskCleanupDeleting, style: TextStyle(color: Colors.grey.shade400)),
            ],
          ),
        ),
      ),
      _ => null,
    };
  }

  Widget _buildConfig(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(context.l10n.taskCleanupConfigIntro, style: TextStyle(color: Colors.grey.shade400)),
        const SizedBox(height: 16),
        ...TaskCleanupStrategy.values.map((strategy) {
          final copy = _strategyCopy(context, strategy);
          return CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _selected.contains(strategy),
            onChanged: (_) => _toggleStrategy(strategy),
            title: Row(
              children: [
                Expanded(child: Text(copy.title, style: const TextStyle(color: Colors.white))),
                if (strategy.slow)
                  Container(
                    margin: const EdgeInsets.only(left: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      context.l10n.taskCleanupSlowBadge,
                      style: const TextStyle(color: Colors.amber, fontSize: 11),
                    ),
                  ),
              ],
            ),
            subtitle: Text(copy.detail, style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
            controlAffinity: ListTileControlAffinity.leading,
          );
        }),
        if (_hasSlow) ...[
          const SizedBox(height: 8),
          _warningBanner(context, context.l10n.taskCleanupSlowWarning),
        ],
        if (_error != null) ...[
          const SizedBox(height: 8),
          _errorBanner(context, _error!),
        ],
      ],
    );
  }

  Widget _buildLoading(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(context.l10n.taskCleanupAnalyzing, style: const TextStyle(color: Colors.white)),
          if (_hasSlow) ...[
            const SizedBox(height: 8),
            Text(context.l10n.taskCleanupAnalyzingSlowHint, style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
          ],
        ],
      ),
    );
  }

  Widget _buildPreview(BuildContext context) {
    final preview = _preview;
    if (preview == null) return const SizedBox.shrink();

    final meta = preview.candidateMeta;
    final breakdownEntries = preview.breakdown.entries.where((e) => (e.value as num) > 0).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          preview.totalCandidates > 0
              ? (preview.totalCandidates == 1
                    ? context.l10n.taskCleanupFoundOneTask
                    : context.l10n.taskCleanupFoundTasks(preview.totalCandidates))
              : context.l10n.taskCleanupNothingFound,
          style: const TextStyle(color: Colors.white),
        ),
        if (preview.scanTruncated) ...[
          const SizedBox(height: 12),
          _warningBanner(
            context,
            context.l10n.taskCleanupScanTruncated(
              preview.scanCap,
              preview.totalOpenActionItems,
              preview.totalOpenActionItems - preview.scanCap,
            ),
          ),
        ],
        if (breakdownEntries.isNotEmpty) ...[
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1C1C1E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: breakdownEntries
                  .map(
                    (entry) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(_strategyLabel(context, entry.key), style: TextStyle(color: Colors.grey.shade400)),
                          Text('${entry.value}', style: const TextStyle(color: Colors.white)),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        ],
        if (meta.isNotEmpty) ...[
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                context.l10n.taskCleanupReviewHeader(_remainingCount, meta.length),
                style: TextStyle(color: Colors.grey.shade500, fontSize: 12, fontWeight: FontWeight.w600),
              ),
              Row(
                children: [
                  GestureDetector(
                    onTap: () => setState(_excludedIds.clear),
                    child: Text(context.l10n.taskCleanupSelectAll, style: TextStyle(color: Colors.grey.shade400, fontSize: 12)),
                  ),
                  Text(' · ', style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
                  GestureDetector(
                    onTap: () => setState(() => _excludedIds.addAll(meta.map((c) => c.id))),
                    child: Text(
                      context.l10n.taskCleanupDeselectAll,
                      style: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          Material(
            color: const Color(0xFF1C1C1E),
            borderRadius: BorderRadius.circular(12),
            clipBehavior: Clip.antiAlias,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 320),
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: meta.length,
                itemBuilder: (context, index) {
                  final item = meta[index];
                  final excluded = _excludedIds.contains(item.id);
                  return CheckboxListTile(
                    dense: true,
                    value: !excluded,
                    onChanged: (_) => _toggleCandidate(item.id),
                    title: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          margin: const EdgeInsets.only(top: 2, right: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            _strategyLabel(context, item.strategy),
                            style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            item.description,
                            style: TextStyle(
                              color: excluded ? Colors.grey.shade600 : Colors.grey.shade300,
                              decoration: excluded ? TextDecoration.lineThrough : null,
                            ),
                          ),
                        ),
                      ],
                    ),
                    controlAffinity: ListTileControlAffinity.leading,
                  );
                },
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        Text(
          context.l10n.taskCleanupPermanentWarning((preview.expiresInSeconds / 60).round()),
          style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
        ),
      ],
    );
  }

  Widget _buildDeleting(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(context.l10n.taskCleanupDeleting, style: const TextStyle(color: Colors.white)),
        ],
      ),
    );
  }

  Widget _warningBanner(BuildContext context, String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FaIcon(FontAwesomeIcons.circleExclamation, color: Colors.amber, size: 14),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: const TextStyle(color: Colors.amber, fontSize: 13))),
        ],
      ),
    );
  }

  Widget _errorBanner(BuildContext context, String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.red.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FaIcon(FontAwesomeIcons.circleExclamation, color: Colors.redAccent, size: 14),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: const TextStyle(color: Colors.redAccent, fontSize: 13))),
        ],
      ),
    );
  }
}
