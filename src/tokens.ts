import type { ToolSet } from 'ai'

export interface AiGatewayConfig {
  accountId: string
  gatewayId: string
  apiKey: string
  modelId: string
}

/**
 * Factory that returns a fresh ToolSet per invocation. A fresh set is
 * required because the memory tools enforce a per-run "must read before
 * update" rule via a closure-scoped Set, which must not leak across
 * service calls.
 */
export type CreateAITools = () => ToolSet

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
  AiGatewayConfig: 'AiGatewayConfig',
  MemoryKv: 'MemoryKv',
  MemoryEntryLimit: 'MemoryEntryLimit',
  MemoryDescriptionLimit: 'MemoryDescriptionLimit',
  SummaryHours: 'SummaryHours',

  GitHubAppId: 'GitHubAppId',
  GitHubPrivateKey: 'GitHubPrivateKey',
  GitHubInstallationId: 'GitHubInstallationId',
  GitHubOrg: 'GitHubOrg',
  GitHubProjectNumber: 'GitHubProjectNumber',

  // Langfuse telemetry (optional)
  LangfuseConfig: 'LangfuseConfig',

  // OTel tracer (optional — set per-request when telemetry is enabled)
  Tracer: 'Tracer',

  // Port interfaces
  MemoryStore: 'MemoryStore',
  GitHubSource: 'GitHubSource',
  DiscordSource: 'DiscordSource',
  ConversationGrouper: 'ConversationGrouper',
  ActionItemGenerator: 'ActionItemGenerator',
  DiscordNotifier: 'DiscordNotifier',
  SummaryPresenter: 'SummaryPresenter',

  // AI tooling factory
  CreateAITools: 'CreateAITools',
} as const
