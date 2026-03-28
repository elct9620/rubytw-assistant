import { describe, it, expect, vi } from 'vitest'
import { DiscordSummaryPresenter } from '../../src/adapters/discord-summary-presenter'
import type { SummaryResult } from '../../src/usecases/generate-summary'
import type { ActionItem } from '../../src/entities/action-item'
import type { TopicGroup } from '../../src/entities/topic-group'

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

    const sentMessage = notifier.sendMessage.mock.calls[0][1]
    const lines = sentMessage.split('\n')
    expect(lines).toHaveLength(30)
  })
})
