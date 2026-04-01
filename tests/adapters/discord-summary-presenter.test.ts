import { http, HttpResponse } from 'msw'
import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscordSummaryPresenter } from '../../src/adapters/discord-summary-presenter'
import { DiscordNotifierAdapter } from '../../src/adapters/discord-notifier'
import { TOKENS } from '../../src/tokens'
import type { SummaryResult } from '../../src/usecases/ports'
import type { ActionItem } from '../../src/entities/action-item'
import type { TopicGroup } from '../../src/entities/topic-group'
import { server } from '../msw-server'

const MESSAGES_URL = 'https://discord.com/api/v10/channels/channel-123/messages'

function createMockNotifier() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }
}

const actionableGroup: TopicGroup = {
  topic: '官網更新',
  summary: '討論官網改版',
  communityRelated: 'yes',
  smallTalk: 'no',
  lostContext: 'no',
}

const sampleActionItem: ActionItem = {
  status: 'to-do',
  description: '更新官網',
  assignee: 'Alice',
  reason: '官網資訊過舊',
}

beforeEach(() => {
  container.clearInstances()
})

describe('DiscordSummaryPresenter', () => {
  it('should send formatted action items to the channel', async () => {
    const notifier = createMockNotifier()
    const presenter = new DiscordSummaryPresenter(notifier, 'channel-123')

    const result: SummaryResult = {
      topicGroups: [actionableGroup],
      actionItems: [sampleActionItem],
    }

    await presenter.present(result)

    expect(notifier.sendMessage).toHaveBeenCalledWith(
      'channel-123',
      '- [待辦] 更新官網 (Alice) — 官網資訊過舊',
    )
  })

  it('should send no-action-items notice when action items are empty', async () => {
    const notifier = createMockNotifier()
    const presenter = new DiscordSummaryPresenter(notifier, 'channel-123')

    const result: SummaryResult = {
      topicGroups: [actionableGroup],
      actionItems: [],
    }

    await presenter.present(result)

    expect(notifier.sendMessage).toHaveBeenCalledWith(
      'channel-123',
      '本次摘要期間內無待辦事項。',
    )
  })

  it('should cap action items at 30', async () => {
    const notifier = createMockNotifier()
    const presenter = new DiscordSummaryPresenter(notifier, 'channel-123')

    const manyItems: ActionItem[] = Array.from({ length: 35 }, (_, i) => ({
      status: 'to-do' as const,
      description: `任務 ${i + 1}`,
      assignee: 'X',
      reason: '原因',
    }))

    const result: SummaryResult = {
      topicGroups: [actionableGroup],
      actionItems: manyItems,
    }

    await presenter.present(result)

    const allLines = notifier.sendMessage.mock.calls
      .map((call) => (call as [string, string])[1])
      .join('\n')
      .split('\n')
    expect(allLines).toHaveLength(30)
  })

  it('should split into multiple messages when content exceeds 2000 chars', async () => {
    const notifier = createMockNotifier()
    const presenter = new DiscordSummaryPresenter(notifier, 'channel-123')

    const longItems: ActionItem[] = Array.from({ length: 30 }, (_, i) => ({
      status: 'to-do' as const,
      description: `長任務描述第${i + 1}項${'詳'.repeat(40)}`,
      assignee: `負責人${i + 1}`,
      reason: `原因說明需要足夠長${'補'.repeat(40)}`,
    }))

    const result: SummaryResult = {
      topicGroups: [actionableGroup],
      actionItems: longItems,
    }

    await presenter.present(result)

    expect(notifier.sendMessage.mock.calls.length).toBeGreaterThan(1)
    for (const call of notifier.sendMessage.mock.calls) {
      expect((call as [string, string])[1].length).toBeLessThanOrEqual(2000)
    }
  })
})

describe('DiscordSummaryPresenter DI integration', () => {
  it('should resolve full Presenter → Notifier chain and send via Discord API', async () => {
    const sentMessages: string[] = []

    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        const body = (await request.json()) as { content: string }
        sentMessages.push(body.content)
        return HttpResponse.json({})
      }),
    )

    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'di-test-token' })
    child.register(TOKENS.DiscordChannelId, { useValue: 'channel-123' })
    child.register(TOKENS.DiscordNotifier, {
      useClass: DiscordNotifierAdapter,
    })
    const presenter = child.resolve(DiscordSummaryPresenter)

    const result: SummaryResult = {
      topicGroups: [actionableGroup],
      actionItems: [sampleActionItem],
    }

    await presenter.present(result)

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toBe('- [待辦] 更新官網 (Alice) — 官網資訊過舊')
  })

  it('should send chunked messages via Discord API when content is long', async () => {
    const sentMessages: string[] = []

    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        const body = (await request.json()) as { content: string }
        sentMessages.push(body.content)
        return HttpResponse.json({})
      }),
    )

    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'di-test-token' })
    child.register(TOKENS.DiscordChannelId, { useValue: 'channel-123' })
    child.register(TOKENS.DiscordNotifier, {
      useClass: DiscordNotifierAdapter,
    })
    const presenter = child.resolve(DiscordSummaryPresenter)

    const longItems: ActionItem[] = Array.from({ length: 30 }, (_, i) => ({
      status: 'to-do' as const,
      description: `長任務描述第${i + 1}項${'詳'.repeat(40)}`,
      assignee: `負責人${i + 1}`,
      reason: `原因說明需要足夠長${'補'.repeat(40)}`,
    }))

    await presenter.present({
      topicGroups: [actionableGroup],
      actionItems: longItems,
    })

    expect(sentMessages.length).toBeGreaterThan(1)
    for (const msg of sentMessages) {
      expect(msg.length).toBeLessThanOrEqual(2000)
    }
  })
})
