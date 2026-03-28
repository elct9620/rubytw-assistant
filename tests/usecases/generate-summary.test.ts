import { describe, it, expect, vi } from 'vitest'
import {
  GenerateSummary,
  type GenerateSummaryDeps,
} from '../../src/usecases/generate-summary'
import type { TopicGroup } from '../../src/entities/topic-group'
import type { ActionItem } from '../../src/entities/action-item'

const actionableGroup: TopicGroup = {
  topic: '官網更新',
  summary: '討論官網改版',
  communityRelated: 'yes',
  smallTalk: 'no',
  lostContext: 'no',
}

const smallTalkGroup: TopicGroup = {
  topic: '閒聊',
  summary: '聊天內容',
  communityRelated: 'yes',
  smallTalk: 'yes',
  lostContext: 'no',
}

const nonCommunityGroup: TopicGroup = {
  topic: '其他',
  summary: '非社群相關',
  communityRelated: 'no',
  smallTalk: 'no',
  lostContext: 'no',
}

const sampleActionItem: ActionItem = {
  status: 'to-do',
  description: '更新官網',
  assignee: 'Alice',
  reason: '官網資訊過舊',
}

function createStubDeps(
  overrides?: Partial<GenerateSummaryDeps>,
): GenerateSummaryDeps {
  return {
    github: {
      getIssues: vi.fn().mockResolvedValue([]),
      getProjectActivities: vi.fn().mockResolvedValue([]),
    },
    discord: {
      getChannelMessages: vi.fn().mockResolvedValue(['msg-1', 'msg-2']),
    },
    conversationGrouper: {
      groupConversations: vi
        .fn()
        .mockResolvedValue([actionableGroup, smallTalkGroup]),
    },
    actionItemGenerator: {
      generateActionItems: vi.fn().mockResolvedValue([sampleActionItem]),
    },
    notifier: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

describe('GenerateSummary', () => {
  it('should run two-phase pipeline and send formatted action items', async () => {
    const deps = createStubDeps()
    const usecase = new GenerateSummary(deps)

    await usecase.execute('channel-123', 24)

    expect(deps.discord.getChannelMessages).toHaveBeenCalledWith(24)
    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith([
      'msg-1',
      'msg-2',
    ])
    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith([
      actionableGroup,
    ])
    expect(deps.notifier.sendMessage).toHaveBeenCalledWith(
      'channel-123',
      '- [to-do] 更新官網 (Alice) — 官網資訊過舊',
    )
  })

  it('should filter out non-community and small-talk groups', async () => {
    const deps = createStubDeps({
      conversationGrouper: {
        groupConversations: vi
          .fn()
          .mockResolvedValue([
            actionableGroup,
            smallTalkGroup,
            nonCommunityGroup,
          ]),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute('ch', 12)

    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith([
      actionableGroup,
    ])
  })

  it('should send no-action-items notice when no messages found', async () => {
    const deps = createStubDeps({
      discord: {
        getChannelMessages: vi.fn().mockResolvedValue([]),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute('ch', 24)

    expect(deps.conversationGrouper.groupConversations).not.toHaveBeenCalled()
    expect(deps.notifier.sendMessage).toHaveBeenCalledWith(
      'ch',
      '本次摘要期間內無待辦事項。',
    )
  })

  it('should send no-action-items notice when all groups are filtered out', async () => {
    const deps = createStubDeps({
      conversationGrouper: {
        groupConversations: vi
          .fn()
          .mockResolvedValue([smallTalkGroup, nonCommunityGroup]),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute('ch', 24)

    expect(deps.actionItemGenerator.generateActionItems).not.toHaveBeenCalled()
    expect(deps.notifier.sendMessage).toHaveBeenCalledWith(
      'ch',
      '本次摘要期間內無待辦事項。',
    )
  })

  it('should cap action items at 30', async () => {
    const manyItems: ActionItem[] = Array.from({ length: 35 }, (_, i) => ({
      status: 'to-do' as const,
      description: `任務 ${i + 1}`,
      assignee: 'X',
      reason: '原因',
    }))
    const deps = createStubDeps({
      actionItemGenerator: {
        generateActionItems: vi.fn().mockResolvedValue(manyItems),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute('ch', 24)

    const sentMessage = vi.mocked(deps.notifier.sendMessage).mock.calls[0][1]
    const lines = sentMessage.split('\n')
    expect(lines).toHaveLength(30)
  })

  it('should collect GitHub and Discord data in parallel', async () => {
    const order: string[] = []
    const deps = createStubDeps({
      github: {
        getIssues: vi.fn().mockImplementation(async () => {
          order.push('issues')
          return []
        }),
        getProjectActivities: vi.fn().mockImplementation(async () => {
          order.push('activities')
          return []
        }),
      },
      discord: {
        getChannelMessages: vi.fn().mockImplementation(async () => {
          order.push('messages')
          return ['msg']
        }),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute('ch', 12)

    expect(order).toContain('issues')
    expect(order).toContain('activities')
    expect(order).toContain('messages')
  })
})
