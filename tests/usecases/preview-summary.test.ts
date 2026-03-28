import { describe, it, expect, vi } from 'vitest'
import { PreviewSummary } from '../../src/usecases/preview-summary'
import type { TopicGroup } from '../../src/entities/topic-group'
import type { ActionItem } from '../../src/entities/action-item'

function createStubs({
  messages = [] as string[],
  groups = [] as TopicGroup[],
  actionItems = [] as ActionItem[],
} = {}) {
  return {
    discord: {
      getChannelMessages: vi.fn().mockResolvedValue(messages),
    },
    conversationGrouper: {
      groupConversations: vi.fn().mockResolvedValue(groups),
    },
    actionItemGenerator: {
      generateActionItems: vi.fn().mockResolvedValue(actionItems),
    },
  }
}

describe('PreviewSummary', () => {
  it('should return topic groups and action items', async () => {
    const groups: TopicGroup[] = [
      {
        topic: 'Rails upgrade',
        summary: 'Discussing Rails 8',
        communityRelated: 'yes',
        smallTalk: 'no',
        lostContext: 'no',
      },
    ]
    const items: ActionItem[] = [
      {
        status: 'to-do',
        description: 'Upgrade Rails',
        assignee: 'Alice',
        reason: 'Security patch',
      },
    ]
    const deps = createStubs({
      messages: ['<item>msg</item>'],
      groups,
      actionItems: items,
    })
    const usecase = new PreviewSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({ topicGroups: groups, actionItems: items })
    expect(deps.discord.getChannelMessages).toHaveBeenCalledWith(24)
    expect(deps.conversationGrouper.groupConversations).toHaveBeenCalledWith([
      '<item>msg</item>',
    ])
    expect(deps.actionItemGenerator.generateActionItems).toHaveBeenCalledWith(
      groups,
    )
  })

  it('should return empty result when no messages found', async () => {
    const deps = createStubs({ messages: [] })
    const usecase = new PreviewSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({ topicGroups: [], actionItems: [] })
    expect(deps.conversationGrouper.groupConversations).not.toHaveBeenCalled()
  })

  it('should return empty action items when no actionable groups', async () => {
    const groups: TopicGroup[] = [
      {
        topic: 'Greetings',
        summary: 'Just saying hi',
        communityRelated: 'no',
        smallTalk: 'yes',
        lostContext: 'no',
      },
    ]
    const deps = createStubs({
      messages: ['<item>hi</item>'],
      groups,
    })
    const usecase = new PreviewSummary(deps)

    const result = await usecase.execute(24)

    expect(result).toEqual({ topicGroups: groups, actionItems: [] })
    expect(deps.actionItemGenerator.generateActionItems).not.toHaveBeenCalled()
  })
})
