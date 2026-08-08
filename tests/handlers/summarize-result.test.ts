import { describe, it, expect } from 'vitest'
import {
  classifySummaryResult,
  summarizeResult,
} from '../../src/handlers/summarize-result'
import type { SummaryResult } from '../../src/usecases/ports'
import type { ActionItem } from '../../src/entities/action-item'
import type { TopicGroup } from '../../src/entities/topic-group'

const topicGroup = (topic: string): TopicGroup =>
  ({
    topic,
    summary: 'summary',
    communityRelated: 'yes',
    smallTalk: 'no',
    lostContext: 'no',
  }) as TopicGroup

const actionItem = (description: string): ActionItem =>
  ({
    status: 'to-do',
    description,
    assignee: 'someone',
    reason: 'reason',
  }) as ActionItem

describe('summarizeResult', () => {
  it('should reduce a success to its counts', () => {
    const result: SummaryResult = {
      kind: 'success',
      topicGroups: [topicGroup('a'), topicGroup('b')],
      actionItems: [actionItem('do it')],
    }

    expect(summarizeResult(result)).toEqual({
      kind: 'success',
      topicGroupCount: 2,
      actionItemCount: 1,
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
    ['success', { kind: 'success', topicGroups: [], actionItems: [] }],
    ['empty', { kind: 'empty' }],
  ] as const)('should leave a %s run unclassified', (_kind, result) => {
    expect(classifySummaryResult(result as SummaryResult)).toBeUndefined()
  })
})
