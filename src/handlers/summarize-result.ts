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
    case 'success':
      return {
        kind: 'success',
        itemCount: result.items.length,
      }
    case 'failure':
      return {
        kind: 'failure',
        reason: result.reason,
      }
  }
}

/**
 * Flag failed results as WARNING so Langfuse/OTel viewers can surface
 * degraded runs at a glance. Successful results are normal and
 * return undefined (no classification).
 */
export function classifySummaryResult(
  result: SummaryResult,
): ResultClassification | undefined {
  if (result.kind === 'failure') {
    return { level: 'WARNING', statusMessage: result.reason }
  }
  return undefined
}
