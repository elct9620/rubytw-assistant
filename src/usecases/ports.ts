import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'

export interface IssueFilter {
  state?: 'OPEN' | 'CLOSED'
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

export interface SummarySuccess {
  kind: 'success'
  topicGroups: TopicGroup[]
  actionItems: ActionItem[]
}

export interface SummaryEmpty {
  kind: 'empty'
}

export interface SummaryFallback {
  kind: 'fallback'
  rawMessages: string[]
  reason: string
}

export type SummaryResult = SummarySuccess | SummaryEmpty | SummaryFallback

export interface SummaryPresenter {
  present(result: SummaryResult): Promise<void>
}

export interface MemorySlot {
  index: number
  description: string
}

export interface MemorySlotDetail extends MemorySlot {
  content: string
}

export interface MemoryStore {
  list(): Promise<MemorySlot[]>
  read(indices: number[]): Promise<MemorySlotDetail[]>
  update(index: number, description: string, content: string): Promise<void>
}
