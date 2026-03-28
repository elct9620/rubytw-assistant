import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import { isActionable } from '../entities/topic-group'
import { formatActionItems } from '../entities/action-item'

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

export interface GenerateSummaryDeps {
  github: GitHubSource
  discord: DiscordSource
  conversationGrouper: ConversationGrouper
  actionItemGenerator: ActionItemGenerator
  notifier: DiscordNotifier
}

const MAX_ACTION_ITEMS = 30
const NO_ACTION_ITEMS_NOTICE = '本次摘要期間內無待辦事項。'

export class GenerateSummary {
  constructor(private deps: GenerateSummaryDeps) {}

  async execute(channelId: string, hours: number): Promise<void> {
    const [, , messages] = await Promise.all([
      this.deps.github.getIssues(),
      this.deps.github.getProjectActivities(),
      this.deps.discord.getChannelMessages(hours),
    ])

    if (messages.length === 0) {
      await this.deps.notifier.sendMessage(channelId, NO_ACTION_ITEMS_NOTICE)
      return
    }

    const groups =
      await this.deps.conversationGrouper.groupConversations(messages)
    const actionableGroups = groups.filter(isActionable)

    if (actionableGroups.length === 0) {
      await this.deps.notifier.sendMessage(channelId, NO_ACTION_ITEMS_NOTICE)
      return
    }

    const actionItems =
      await this.deps.actionItemGenerator.generateActionItems(actionableGroups)
    const capped = actionItems.slice(0, MAX_ACTION_ITEMS)
    const summary = formatActionItems(capped)
    await this.deps.notifier.sendMessage(channelId, summary)
  }
}
