import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import type {
  DiscordSource,
  ConversationGrouper,
  ActionItemGenerator,
} from './generate-summary'
import { isActionable } from '../entities/topic-group'

export interface PreviewSummaryResult {
  topicGroups: TopicGroup[]
  actionItems: ActionItem[]
}

export interface PreviewSummaryDeps {
  discord: DiscordSource
  conversationGrouper: ConversationGrouper
  actionItemGenerator: ActionItemGenerator
}

export class PreviewSummary {
  constructor(private deps: PreviewSummaryDeps) {}

  async execute(hours: number): Promise<PreviewSummaryResult> {
    const messages = await this.deps.discord.getChannelMessages(hours)

    if (messages.length === 0) {
      return { topicGroups: [], actionItems: [] }
    }

    const topicGroups =
      await this.deps.conversationGrouper.groupConversations(messages)
    const actionableGroups = topicGroups.filter(isActionable)

    if (actionableGroups.length === 0) {
      return { topicGroups, actionItems: [] }
    }

    const actionItems =
      await this.deps.actionItemGenerator.generateActionItems(actionableGroups)

    return { topicGroups, actionItems }
  }
}
