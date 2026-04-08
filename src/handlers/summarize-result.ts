import type { SummaryResult } from '../usecases/ports'
import type { ResultClassification } from './telemetry-setup'

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

/**
 * Flag fallback results as WARNING so Langfuse/OTel viewers can surface
 * degraded runs at a glance. Success and empty results are normal and
 * return undefined (no classification).
 */
export function classifySummaryResult(
  result: SummaryResult,
): ResultClassification | undefined {
  if (result.kind === 'fallback') {
    return { level: 'WARNING', message: result.reason }
  }
  return undefined
}
