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
  /** Reaches issues that are not on the project board; `status` is null for those. */
  searchIssues(query: string): Promise<IssueOverview[]>
  readIssues(numbers: number[], bodyLimit: number): Promise<IssueDetail[]>
}

export interface ReadMessagesQuery {
  /** Inclusive. */
  since: Date
  /** Exclusive; omitted means up to now. */
  until?: Date
  limit: number
  /** A `nextCursor` from an earlier page of the same range. */
  cursor?: string
}

export interface MessagePage {
  /** Oldest first. */
  messages: string[]
  /** Null once the range is exhausted. */
  nextCursor: string | null
}

/** Every condition given must hold; none given matches the whole channel. */
export interface SearchMessagesQuery {
  query?: string
  /** A member id, or `self` for the assistant. */
  author?: string
  /** `reply` also finds replies that did not notify the assistant. */
  involvesSelf?: 'mention' | 'reply'
  /** Inclusive. */
  since?: Date
  /** Exclusive. */
  until?: Date
  /** A `nextCursor` from an earlier page of the same search. */
  cursor?: string
}

export interface MessageSearchPage {
  /** Newest first. */
  messages: string[]
  /** All matches, as Discord approximates it. */
  total: number
  /** Null once the matches are exhausted. */
  nextCursor: string | null
}

export interface DiscordSource {
  readMessages(query: ReadMessagesQuery): Promise<MessagePage>
  searchMessages(query: SearchMessagesQuery): Promise<MessageSearchPage>
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

/** Slot index to the values written there. */
export type MemoryUpdate = Record<
  number,
  { description: string; content: string }
>

export interface MemoryStore {
  list(): Promise<MemorySlot[]>
  read(indices: number[]): Promise<MemorySlotDetail[]>
  /** All-or-nothing: nothing is written unless every entry is valid. */
  update(entries: MemoryUpdate): Promise<void>
}

export interface MemorySummaryStore {
  read(): Promise<string | null>
  write(summary: string): Promise<void>
}

export interface MemorySummarizer {
  summarize(): Promise<string | null>
}
