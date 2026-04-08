import type { SummaryResult } from '../usecases/ports'

/**
 * Reduce a SummaryResult to a small object suitable for telemetry
 * attributes and structured logs. Shared by the cron and debug handlers
 * so the trace shape stays consistent.
 */
export function summarizeResult(
  result: SummaryResult,
): Record<string, unknown> {
  switch (result.kind) {
    case 'empty':
      return { kind: 'empty' }
    case 'success':
      return {
        kind: 'success',
        topicGroupCount: result.topicGroups.length,
        actionItemCount: result.actionItems.length,
      }
    case 'fallback':
      return {
        kind: 'fallback',
        rawMessageCount: result.rawMessages.length,
        reason: result.reason,
      }
  }
}
