import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import type { MemoryEntry } from '../entities/memory-entry'

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

export interface MemoryStore {
  list(): Promise<MemoryEntry[]>
  put(entry: MemoryEntry): Promise<void>
  delete(key: string): Promise<void>
  count(): Promise<number>
}
