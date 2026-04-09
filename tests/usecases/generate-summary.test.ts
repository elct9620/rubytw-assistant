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
    ...overrides,
  }
}

describe('GenerateSummary', () => {
  it('should run two-phase pipeline and return success result', async () => {
    const deps = createStubDeps()
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(deps.discord.getChannelMessages).toHaveBeenCalledWith(24)
    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith([
      'msg-1',
      'msg-2',
    ])
    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith([
      actionableGroup,
    ])
    expect(result).toEqual({
      kind: 'success',
      topicGroups: [actionableGroup, smallTalkGroup],
      actionItems: [sampleActionItem],
    })
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

    await usecase.execute(12)

    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith([
      actionableGroup,
    ])
  })

  it('should return empty result when no messages found', async () => {
    const deps = createStubDeps({
      discord: {
        getChannelMessages: vi.fn().mockResolvedValue([]),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({ kind: 'empty' })
    expect(deps.conversationGrouper.groupConversations).not.toHaveBeenCalled()
  })

  it('should return success with empty action items when all groups are filtered out', async () => {
    const deps = createStubDeps({
      conversationGrouper: {
        groupConversations: vi
          .fn()
          .mockResolvedValue([smallTalkGroup, nonCommunityGroup]),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({
      kind: 'success',
      topicGroups: [smallTalkGroup, nonCommunityGroup],
      actionItems: [],
    })
    expect(deps.actionItemGenerator.generateActionItems).not.toHaveBeenCalled()
  })

  it('should fall back to raw messages when conversation grouping fails', async () => {
    const deps = createStubDeps({
      conversationGrouper: {
        groupConversations: vi
          .fn()
          .mockRejectedValue(new Error('grouper down')),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({
      kind: 'fallback',
      rawMessages: ['msg-1', 'msg-2'],
      reason: '[Conversation Grouping] grouper down',
    })
    expect(deps.actionItemGenerator.generateActionItems).not.toHaveBeenCalled()
  })

  it('should fall back to raw messages when action item generation fails', async () => {
    const deps = createStubDeps({
      actionItemGenerator: {
        generateActionItems: vi
          .fn()
          .mockRejectedValue(new Error('generator down')),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({
      kind: 'fallback',
      rawMessages: ['msg-1', 'msg-2'],
      reason: '[Action Item Generation] generator down',
    })
  })

  it('should propagate Discord collection errors without fallback', async () => {
    const deps = createStubDeps({
      discord: {
        getChannelMessages: vi
          .fn()
          .mockRejectedValue(new Error('discord down')),
      },
    })
    const usecase = new GenerateSummary(deps)

    await expect(usecase.execute(24)).rejects.toThrow('discord down')
  })
})
