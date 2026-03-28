import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import { isActionable } from '../entities/topic-group'

export interface GitHubSource {
  getIssues(): Promise<string[]>
  getProjectActivities(): Promise<string[]>
}

export interface DiscordSource {
  getChannelMessages(hours: number): Promise<string[]>
}

export interface ConversationGrouper {
  groupConversations(messages: string[]): Promise<TopicGroup[]>
}

export interface ActionItemGenerator {
  generateActionItems(groups: TopicGroup[]): Promise<ActionItem[]>
}

export interface DiscordNotifier {
  sendMessage(channelId: string, content: string): Promise<void>
}

export interface SummaryResult {
  topicGroups: TopicGroup[]
  actionItems: ActionItem[]
}

export interface SummaryPresenter {
  present(result: SummaryResult): Promise<void>
}

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
