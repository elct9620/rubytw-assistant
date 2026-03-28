import { isActionable } from '../entities/topic-group'
import type {
  GitHubSource,
  DiscordSource,
  ConversationGrouper,
  ActionItemGenerator,
  SummaryResult,
} from './ports'

export type { SummaryResult } from './ports'
export type { SummaryPresenter } from './ports'

export interface GenerateSummaryDeps {
  github: GitHubSource
  discord: DiscordSource
  conversationGrouper: ConversationGrouper
  actionItemGenerator: ActionItemGenerator
}

export class GenerateSummary {
  constructor(private deps: GenerateSummaryDeps) {}

  async execute(hours: number): Promise<SummaryResult> {
    const [, , messages] = await Promise.all([
      this.deps.github.getIssues(),
      this.deps.github.getProjectActivities(),
      this.deps.discord.getChannelMessages(hours),
    ])

    if (messages.length === 0) {
      return { topicGroups: [], actionItems: [] }
    }

    const groups =
      await this.deps.conversationGrouper.groupConversations(messages)
    const actionableGroups = groups.filter(isActionable)

    if (actionableGroups.length === 0) {
      return { topicGroups: groups, actionItems: [] }
    }

    const actionItems =
      await this.deps.actionItemGenerator.generateActionItems(actionableGroups)

    return { topicGroups: groups, actionItems }
  }
}
