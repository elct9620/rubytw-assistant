import { createScheduledController } from 'cloudflare:test'
import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import type { SummaryResult } from '../../src/usecases/ports'
import { scheduledHandler } from '../../src/handlers/scheduled'

const presentedResults: SummaryResult[] = []

function registerStubPorts() {
  container.register(TOKENS.SummaryHours, { useValue: 24 })

  container.register(TOKENS.DiscordSource, {
    useValue: {
      readMessages: vi.fn().mockResolvedValue({
        messages: [
          '<item id="1"><user bot="false">Alice</user><content>來討論官網改版</content></item>',
          '<item id="2"><user bot="false">Bob</user><content>好，我來整理 issue</content></item>',
        ],
        nextCursor: null,
      }),
    },
  })

  container.register(TOKENS.FollowUpAgent, {
    useValue: {
      followUp: vi.fn().mockResolvedValue([
        {
          status: 'stalled',
          description: '整理官網改版 issue',
          assignee: 'Bob',
          lastProgress: '2026-10-05',
          reason: 'Alice 提出官網需要改版',
        },
      ]),
    },
  })

  container.register(TOKENS.MemorySummaryStore, {
    useValue: {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
    },
  })

  container.register(TOKENS.MemoryAgent, {
    useValue: { tidyAndSummarize: vi.fn().mockResolvedValue(null) },
  })

  container.register(TOKENS.LangfuseConfig, { useFactory: () => null })

  container.register(TOKENS.SummaryPresenter, {
    useValue: {
      present: vi.fn().mockImplementation(async (result: SummaryResult) => {
        presentedResults.push(result)
      }),
    },
  })
}

beforeEach(() => {
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
    expect(result.items).toHaveLength(1)
    expect(result.items[0].description).toBe('整理官網改版 issue')
    expect(result.items[0].assignee).toBe('Bob')
  })

  it('should still follow up when the window holds no messages', async () => {
    container.register(TOKENS.DiscordSource, {
      useValue: {
        readMessages: vi
          .fn()
          .mockResolvedValue({ messages: [], nextCursor: null }),
      },
    })

    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })

    await scheduledHandler(controller)

    expect(presentedResults).toHaveLength(1)
    expect(presentedResults[0]).toMatchObject({
      kind: 'success',
      items: [expect.objectContaining({ description: '整理官網改版 issue' })],
    })
  })

  it('should present the raw messages when the Follow-up Agent fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    container.register(TOKENS.FollowUpAgent, {
      useValue: {
        followUp: vi.fn().mockRejectedValue(new Error('token budget exceeded')),
      },
    })

    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })

    await scheduledHandler(controller)

    expect(presentedResults).toHaveLength(1)
    expect(presentedResults[0]).toMatchObject({
      kind: 'fallback',
      reason: '[Follow-up Agent] token budget exceeded',
    })
    vi.restoreAllMocks()
  })
})
