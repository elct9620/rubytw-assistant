export interface AiGatewayConfig {
  accountId: string
  gatewayId: string
  apiKey: string
  modelId: string
}

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

  // Request context
  RequestContext: 'RequestContext',

  // Port interfaces
  MemoryStore: 'MemoryStore',
  GitHubSource: 'GitHubSource',
  DiscordSource: 'DiscordSource',
  ConversationGrouper: 'ConversationGrouper',
  ActionItemGenerator: 'ActionItemGenerator',
  DiscordNotifier: 'DiscordNotifier',
  SummaryPresenter: 'SummaryPresenter',
} as const
