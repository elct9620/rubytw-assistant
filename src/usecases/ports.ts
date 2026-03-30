import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
export interface IssueFilter {
  state?: 'OPEN' | 'CLOSED'
  dueDateFrom?: string
  dueDateTo?: string
}

export interface GitHubSource {
  getIssues(filter?: IssueFilter): Promise<string[]>
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

export interface MemoryStore {
  list(): Promise<{ index: number; description: string }[]>
  read(
    indices: number[],
  ): Promise<{ index: number; description: string; content: string }[]>
  update(index: number, description: string, content: string): Promise<void>
}
