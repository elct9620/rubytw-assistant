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
    memorySummaryStore: {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
    },
    memorySummarizer: {
      summarize: vi.fn().mockResolvedValue(null),
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
    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      undefined,
    )
    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith(
      [actionableGroup],
      undefined,
    )
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

    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith(
      [actionableGroup],
      undefined,
    )
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
    expect(deps.memorySummarizer.summarize).not.toHaveBeenCalled()
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
    expect(deps.memorySummarizer.summarize).not.toHaveBeenCalled()
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

  it('should inject stored memory summary into Phase 1 and Phase 2', async () => {
    const deps = createStubDeps({
      memorySummaryStore: {
        read: vi.fn().mockResolvedValue('previous summary context'),
        write: vi.fn().mockResolvedValue(undefined),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute(24)

    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      'previous summary context',
    )
    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith(
      [actionableGroup],
      'previous summary context',
    )
  })

  it('should skip injection when no stored summary exists', async () => {
    const deps = createStubDeps()
    const usecase = new GenerateSummary(deps)

    await usecase.execute(24)

    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      undefined,
    )
  })

  it('should skip injection when memory summary store read fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createStubDeps({
      memorySummaryStore: {
        read: vi.fn().mockRejectedValue(new Error('KV down')),
        write: vi.fn().mockResolvedValue(undefined),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result.kind).toBe('success')
    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      undefined,
    )
    warnSpy.mockRestore()
  })

  it('should run Phase 3 and write summary after successful pipeline', async () => {
    const deps = createStubDeps({
      memorySummarizer: {
        summarize: vi.fn().mockResolvedValue('new summary'),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute(24)

    expect(deps.memorySummarizer.summarize).toHaveBeenCalled()
    expect(deps.memorySummaryStore.write).toHaveBeenCalledWith('new summary')
  })

  it('should skip write when summarizer returns null (all slots empty)', async () => {
    const deps = createStubDeps({
      memorySummarizer: {
        summarize: vi.fn().mockResolvedValue(null),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute(24)

    expect(deps.memorySummarizer.summarize).toHaveBeenCalled()
    expect(deps.memorySummaryStore.write).not.toHaveBeenCalled()
  })

  it('should continue when Phase 3 summarizer fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createStubDeps({
      memorySummarizer: {
        summarize: vi.fn().mockRejectedValue(new Error('AI down')),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result.kind).toBe('success')
    expect(deps.memorySummaryStore.write).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('should continue when Phase 3 store write fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createStubDeps({
      memorySummarizer: {
        summarize: vi.fn().mockResolvedValue('new summary'),
      },
      memorySummaryStore: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockRejectedValue(new Error('KV write failed')),
      },
    })
    const usecase = new GenerateSummary(deps)

    const result = await usecase.execute(24)

    expect(result.kind).toBe('success')
    warnSpy.mockRestore()
  })

  it('should run Phase 3 even when all groups are filtered out', async () => {
    const deps = createStubDeps({
      conversationGrouper: {
        groupConversations: vi
          .fn()
          .mockResolvedValue([smallTalkGroup, nonCommunityGroup]),
      },
      memorySummarizer: {
        summarize: vi.fn().mockResolvedValue('summary from memory'),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute(24)

    expect(deps.memorySummarizer.summarize).toHaveBeenCalled()
    expect(deps.memorySummaryStore.write).toHaveBeenCalledWith(
      'summary from memory',
    )
  })
})
