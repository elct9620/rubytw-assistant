import { isActionable } from '../entities/topic-group'
import type {
  DiscordSource,
  ConversationGrouper,
  ActionItemGenerator,
  SummaryResult,
} from './ports'

export interface GenerateSummaryDeps {
  discord: DiscordSource
  conversationGrouper: ConversationGrouper
  actionItemGenerator: ActionItemGenerator
}

export class GenerateSummary {
  constructor(private deps: GenerateSummaryDeps) {}

  async execute(hours: number): Promise<SummaryResult> {
    const messages = await this.deps.discord.getChannelMessages(hours)

    if (messages.length === 0) {
      return { kind: 'empty' }
    }

    try {
      const groups =
        await this.deps.conversationGrouper.groupConversations(messages)
      const actionableGroups = groups.filter(isActionable)

      if (actionableGroups.length === 0) {
        return { kind: 'success', topicGroups: groups, actionItems: [] }
      }

      const actionItems =
        await this.deps.actionItemGenerator.generateActionItems(
          actionableGroups,
        )

      return { kind: 'success', topicGroups: groups, actionItems }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'AI pipeline failed'
      console.error('AI pipeline failed, falling back to raw messages:', error)
      return { kind: 'fallback', rawMessages: messages, reason }
    }
  }
}
