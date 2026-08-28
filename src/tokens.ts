import type { ToolSet } from 'ai'

export interface AiGatewayConfig {
  accountId: string
  gatewayId: string
  apiKey: string
  modelId: string
}

/**
 * Factory-injection type. Resolving the matching token gives a zero-arg
 * function that returns a fresh ToolSet per call. A new instance per
 * call is required because the memory tools enforce a "must read before
 * update" rule via a closure-scoped Set, which must not leak across
 * service invocations.
 */
export type AIToolsFactory = () => ToolSet

export interface LangfuseConfig {
  publicKey: string
  secretKey: string
  baseUrl?: string
  environment?: string
}

export const TOKENS = {
  // Env bindings
  DiscordBotToken: 'DiscordBotToken',
  DiscordChannelId: 'DiscordChannelId',
  DiscordGuildId: 'DiscordGuildId',
  DiscordOperatorRoleId: 'DiscordOperatorRoleId',
  DiscordClientId: 'DiscordClientId',
  DiscordClientSecret: 'DiscordClientSecret',
  OAuthKv: 'OAuthKv',
  AiGatewayConfig: 'AiGatewayConfig',
  MemoryKv: 'MemoryKv',
  MemoryEntryLimit: 'MemoryEntryLimit',
  MemoryDescriptionLimit: 'MemoryDescriptionLimit',
  MemorySummaryLengthLimit: 'MemorySummaryLengthLimit',
  IssueBodyLengthLimit: 'IssueBodyLengthLimit',
  SummaryHours: 'SummaryHours',
  SummaryItemLimit: 'SummaryItemLimit',

  GitHubAppId: 'GitHubAppId',
  GitHubPrivateKey: 'GitHubPrivateKey',
  GitHubInstallationId: 'GitHubInstallationId',
  GitHubOrg: 'GitHubOrg',
  GitHubRepo: 'GitHubRepo',
  GitHubProjectNumber: 'GitHubProjectNumber',

  // Langfuse telemetry (optional)
  LangfuseConfig: 'LangfuseConfig',

  // AI SDK telemetry integration (optional — set per-request when
  // telemetry is enabled)
  Telemetry: 'Telemetry',

  // Port interfaces
  MemoryStore: 'MemoryStore',
  MemorySummaryStore: 'MemorySummaryStore',
  MemorySummarizer: 'MemorySummarizer',
  GitHubSource: 'GitHubSource',
  DiscordSource: 'DiscordSource',
  ConversationGrouper: 'ConversationGrouper',
  ActionItemGenerator: 'ActionItemGenerator',
  DiscordNotifier: 'DiscordNotifier',
  GuildRoleChecker: 'GuildRoleChecker',
  DiscordIdentityProvider: 'DiscordIdentityProvider',
  LoginStateStore: 'LoginStateStore',
  SummaryPresenter: 'SummaryPresenter',

  // Factory-injection tokens — resolve to a callable that produces a
  // fresh instance per invocation (not the instance itself).
  AIToolsFactory: 'AIToolsFactory',
} as const
