import { createScheduledController } from 'cloudflare:test'
import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import type { SummaryResult } from '../../src/usecases/ports'
import { scheduledHandler } from '../../src/handlers/scheduled'

const presentedResults: SummaryResult[] = []

function registerStubPorts() {
  container.register(TOKENS.SummaryHours, { useValue: 24 })

  container.register(TOKENS.DiscordSource, {
    useValue: {
      getChannelMessages: vi
        .fn()
        .mockResolvedValue([
          '<item id="1"><user bot="false">Alice</user><content>來討論官網改版</content></item>',
          '<item id="2"><user bot="false">Bob</user><content>好，我來整理 issue</content></item>',
        ]),
    },
  })

  container.register(TOKENS.ConversationGrouper, {
    useValue: {
      groupConversations: vi.fn().mockResolvedValue([
        {
          topic: '官網改版',
          summary: '討論官網改版計畫',
          communityRelated: 'yes',
          smallTalk: 'no',
          lostContext: 'no',
        },
      ]),
    },
  })

  container.register(TOKENS.ActionItemGenerator, {
    useValue: {
      generateActionItems: vi.fn().mockResolvedValue([
        {
          status: 'to-do',
          description: '整理官網改版 issue',
          assignee: 'Bob',
          reason: 'Alice 提出官網需要改版',
        },
      ]),
    },
  })

  container.register(TOKENS.LangfuseConfig, { useFactory: () => null })

  container.register(TOKENS.SummaryPresenter, {
    useValue: {
      present: vi.fn().mockImplementation(async (result: SummaryResult) => {
        presentedResults.push(result)
      }),
    },
  })

  container.register(GenerateSummary, {
    useFactory: (c) =>
      new GenerateSummary({
        discord: c.resolve(TOKENS.DiscordSource),
        conversationGrouper: c.resolve(TOKENS.ConversationGrouper),
        actionItemGenerator: c.resolve(TOKENS.ActionItemGenerator),
      }),
  })
}

beforeEach(() => {
  container.clearInstances()
  presentedResults.length = 0
  registerStubPorts()
})

describe('scheduled pipeline integration', () => {
  it('should run full pipeline from cron to presenter', async () => {
    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })

    await scheduledHandler(controller)

    expect(presentedResults).toHaveLength(1)
    const result = presentedResults[0]
    if (result.kind !== 'success') {
      throw new Error(`expected success result, got ${result.kind}`)
    }
    expect(result.topicGroups).toHaveLength(1)
    expect(result.topicGroups[0].topic).toBe('官網改版')
    expect(result.actionItems).toHaveLength(1)
    expect(result.actionItems[0].description).toBe('整理官網改版 issue')
    expect(result.actionItems[0].assignee).toBe('Bob')
  })

  it('should present empty result when no messages', async () => {
    container.register(TOKENS.DiscordSource, {
      useValue: {
        getChannelMessages: vi.fn().mockResolvedValue([]),
      },
    })

    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })

    await scheduledHandler(controller)

    expect(presentedResults).toHaveLength(1)
    expect(presentedResults[0]).toEqual({ kind: 'empty' })
  })

  it('should skip action item generation when all groups are non-actionable', async () => {
    const generateActionItems = vi.fn()

    container.register(TOKENS.ConversationGrouper, {
      useValue: {
        groupConversations: vi.fn().mockResolvedValue([
          {
            topic: '閒聊',
            summary: '聊天',
            communityRelated: 'yes',
            smallTalk: 'yes',
            lostContext: 'no',
          },
        ]),
      },
    })

    container.register(TOKENS.ActionItemGenerator, {
      useValue: { generateActionItems },
    })

    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })

    await scheduledHandler(controller)

    expect(generateActionItems).not.toHaveBeenCalled()
    expect(presentedResults).toHaveLength(1)
    const result = presentedResults[0]
    if (result.kind !== 'success') {
      throw new Error(`expected success result, got ${result.kind}`)
    }
    expect(result.actionItems).toEqual([])
  })
})
