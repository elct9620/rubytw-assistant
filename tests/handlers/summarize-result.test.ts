import { describe, it, expect } from 'vitest'
import {
  classifySummaryResult,
  summarizeResult,
} from '../../src/handlers/summarize-result'
import type { SummaryResult } from '../../src/usecases/ports'
import type { FollowUpItem } from '../../src/entities/follow-up-item'

const item = (description: string): FollowUpItem => ({
  status: 'to-do',
  description,
  assignee: 'someone',
  lastProgress: null,
  reason: 'reason',
})

describe('summarizeResult', () => {
  it('should reduce a success to its counts', () => {
    const result: SummaryResult = {
      kind: 'success',
      items: [item('do it'), item('and this')],
    }

    expect(summarizeResult(result)).toEqual({
      kind: 'success',
      itemCount: 2,
    })
  })

  it('should reduce an empty run to its kind alone', () => {
    expect(summarizeResult({ kind: 'empty' })).toEqual({ kind: 'empty' })
  })

  it('should keep the reason a fallback was taken', () => {
    const result: SummaryResult = {
      kind: 'fallback',
      rawMessages: ['msg-1', 'msg-2'],
      reason: 'AI service down',
    }

    expect(summarizeResult(result)).toEqual({
      kind: 'fallback',
      rawMessageCount: 2,
      reason: 'AI service down',
    })
  })
})

describe('classifySummaryResult', () => {
  it('should flag a fallback as degraded', () => {
    expect(
      classifySummaryResult({
        kind: 'fallback',
        rawMessages: [],
        reason: 'AI service down',
      }),
    ).toEqual({ level: 'WARNING', statusMessage: 'AI service down' })
  })

  it.each([
    ['success', { kind: 'success', items: [] }],
    ['empty', { kind: 'empty' }],
  ] as const)('should leave a %s run unclassified', (_kind, result) => {
    expect(classifySummaryResult(result as SummaryResult)).toBeUndefined()
  })
})
