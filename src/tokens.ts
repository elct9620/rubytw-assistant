export const TOKENS = {
  // Env bindings
  DiscordBotToken: 'DiscordBotToken',
  DiscordChannelId: 'DiscordChannelId',
  CfAccountId: 'CfAccountId',
  CfAigToken: 'CfAigToken',
  AiGatewayId: 'AiGatewayId',
  AiModel: 'AiModel',
  MemoryKv: 'MemoryKv',
  MemoryEntryLimit: 'MemoryEntryLimit',
  SummaryHours: 'SummaryHours',

  GitHubAppId: 'GitHubAppId',
  GitHubPrivateKey: 'GitHubPrivateKey',
  GitHubInstallationId: 'GitHubInstallationId',
  GitHubOrg: 'GitHubOrg',
  GitHubProjectNumber: 'GitHubProjectNumber',

  // Port interfaces
  MemoryStore: 'MemoryStore',
  GitHubSource: 'GitHubSource',
  DiscordSource: 'DiscordSource',
  ConversationGrouper: 'ConversationGrouper',
  ActionItemGenerator: 'ActionItemGenerator',
  DiscordNotifier: 'DiscordNotifier',
  SummaryPresenter: 'SummaryPresenter',
} as const
