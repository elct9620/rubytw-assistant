import { isActionable } from '../entities/topic-group'
import type {
  DiscordSource,
  ConversationGrouper,
  ActionItemGenerator,
  SummaryResult,
} from './ports'

class PipelineError extends Error {
  constructor(
    readonly phase: string,
    cause: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : 'unknown error'
    super(`[${phase}] ${message}`, { cause })
    this.name = 'PipelineError'
  }
}

function formatPipelineError(error: unknown): string {
  if (error instanceof PipelineError) {
    return error.message
  }
  return error instanceof Error ? error.message : 'AI pipeline failed'
}

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
      const groups = await this.deps.conversationGrouper
        .groupConversations(messages)
        .catch((error) => {
          throw new PipelineError('Conversation Grouping', error)
        })

      const actionableGroups = groups.filter(isActionable)

      if (actionableGroups.length === 0) {
        return { kind: 'success', topicGroups: groups, actionItems: [] }
      }

      const actionItems = await this.deps.actionItemGenerator
        .generateActionItems(actionableGroups)
        .catch((error) => {
          throw new PipelineError('Action Item Generation', error)
        })

      return { kind: 'success', topicGroups: groups, actionItems }
    } catch (error) {
      const reason = formatPipelineError(error)
      console.error('AI pipeline failed, falling back to raw messages:', error)
      return { kind: 'fallback', rawMessages: messages, reason }
    }
  }
}
