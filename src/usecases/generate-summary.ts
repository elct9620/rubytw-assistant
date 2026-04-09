import { isActionable } from '../entities/topic-group'
import type {
  DiscordSource,
  ConversationGrouper,
  ActionItemGenerator,
  MemorySummaryStore,
  MemorySummarizer,
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
  memorySummaryStore: MemorySummaryStore
  memorySummarizer: MemorySummarizer
}

export class GenerateSummary {
  constructor(private deps: GenerateSummaryDeps) {}

  async execute(hours: number): Promise<SummaryResult> {
    const messages = await this.deps.discord.getChannelMessages(hours)

    if (messages.length === 0) {
      return { kind: 'empty' }
    }

    // Memory Summary Injection — read previous summary
    let memorySummary: string | undefined
    try {
      const stored = await this.deps.memorySummaryStore.read()
      if (stored) {
        memorySummary = stored
      }
    } catch (error) {
      console.warn(
        'Memory Summary Store read failed, skipping injection:',
        error,
      )
    }

    try {
      const groups = await this.deps.conversationGrouper
        .groupConversations(messages, memorySummary)
        .catch((error) => {
          throw new PipelineError('Conversation Grouping', error)
        })

      const actionableGroups = groups.filter(isActionable)

      if (actionableGroups.length === 0) {
        await this.runMemorySummaryPhase()
        return { kind: 'success', topicGroups: groups, actionItems: [] }
      }

      const actionItems = await this.deps.actionItemGenerator
        .generateActionItems(actionableGroups, memorySummary)
        .catch((error) => {
          throw new PipelineError('Action Item Generation', error)
        })

      await this.runMemorySummaryPhase()
      return { kind: 'success', topicGroups: groups, actionItems }
    } catch (error) {
      const reason = formatPipelineError(error)
      console.error('AI pipeline failed, falling back to raw messages:', error)
      return { kind: 'fallback', rawMessages: messages, reason }
    }
  }

  private async runMemorySummaryPhase(): Promise<void> {
    try {
      const summary = await this.deps.memorySummarizer.summarize()
      if (summary) {
        await this.deps.memorySummaryStore.write(summary)
      }
    } catch (error) {
      console.warn('Memory Summary phase failed, skipping:', error)
    }
  }
}
