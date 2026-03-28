export const TOKENS = {
  // Env bindings
  DiscordBotToken: 'DiscordBotToken',
  DiscordChannelId: 'DiscordChannelId',
  CfAigToken: 'CfAigToken',
  AiModel: 'AiModel',
  MemoryKv: 'MemoryKv',
  MemoryEntryLimit: 'MemoryEntryLimit',
  SummaryHours: 'SummaryHours',

  // Port interfaces
  MemoryStore: 'MemoryStore',
  GitHubSource: 'GitHubSource',
  DiscordSource: 'DiscordSource',
  ConversationGrouper: 'ConversationGrouper',
  ActionItemGenerator: 'ActionItemGenerator',
  DiscordNotifier: 'DiscordNotifier',
  SummaryPresenter: 'SummaryPresenter',
} as const
