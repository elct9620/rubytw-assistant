import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'

export interface IssueOverview {
  title: string
  number: number
  state: string
  url: string
  labels: string[]
  assignees: string[]
  status: string | null
}

export interface IssueDetail extends IssueOverview {
  body: string
}

export interface GitHubSource {
  listIssues(state?: 'OPEN' | 'CLOSED'): Promise<IssueOverview[]>
  readIssues(numbers: number[], bodyLimit: number): Promise<IssueDetail[]>
}

export interface DiscordSource {
  getChannelMessages(hours: number): Promise<string[]>
}

export interface ConversationGrouper {
  groupConversations(
    messages: string[],
    memorySummary?: string,
  ): Promise<TopicGroup[]>
}

export interface ActionItemGenerator {
  generateActionItems(
    groups: TopicGroup[],
    memorySummary?: string,
  ): Promise<ActionItem[]>
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

/** Answers whether a Discord user may manage this assistant's data. */
export interface GuildRoleChecker {
  hasOperatorRole(userId: string): Promise<boolean>
}

export interface DiscordIdentity {
  userId: string
  username: string
}

export interface DiscordIdentityProvider {
  authorizeUrl(redirectUri: string, state: string): string
  exchangeCode(code: string, redirectUri: string): Promise<DiscordIdentity>
}

/** Carries an in-flight login across the round trip to Discord. */
export interface LoginStateStore {
  issue(payload: unknown): Promise<string>
  consume<T>(state: string): Promise<T | null>
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

export interface MemorySummaryStore {
  read(): Promise<string | null>
  write(summary: string): Promise<void>
}

export interface MemorySummarizer {
  summarize(): Promise<string | null>
}
