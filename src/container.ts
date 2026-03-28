import 'reflect-metadata'
import { container } from 'tsyringe'
import { env } from 'cloudflare:workers'
import { TOKENS } from './tokens'
import { KVMemoryStoreAdapter } from './adapters/kv-memory-store'
import { AIServiceAdapter } from './adapters/ai-service'
import { DiscordNotifierAdapter } from './adapters/discord-notifier'
import { DiscordSourceAdapter } from './adapters/discord-source'
import { DiscordSummaryPresenter } from './adapters/discord-summary-presenter'
import { GenerateSummary } from './usecases/generate-summary'

// Env bindings
container.register(TOKENS.DiscordBotToken, { useValue: env.DISCORD_BOT_TOKEN })
container.register(TOKENS.DiscordChannelId, {
  useValue: env.DISCORD_CHANNEL_ID,
})
container.register(TOKENS.CfAigToken, { useValue: env.CF_AIG_TOKEN })
container.register(TOKENS.AiModel, { useValue: env.AI_MODEL })
container.register(TOKENS.MemoryKv, { useValue: env.MEMORY_KV })
container.register(TOKENS.MemoryEntryLimit, {
  useValue: Number(env.MEMORY_ENTRY_LIMIT),
})
container.register(TOKENS.SummaryHours, {
  useValue: Number(env.SUMMARY_HOURS),
})

// Port → Adapter mappings
container.register(TOKENS.MemoryStore, { useClass: KVMemoryStoreAdapter })
container.register(TOKENS.ConversationGrouper, { useClass: AIServiceAdapter })
container.register(TOKENS.ActionItemGenerator, { useClass: AIServiceAdapter })
container.register(TOKENS.DiscordNotifier, { useClass: DiscordNotifierAdapter })
container.register(TOKENS.DiscordSource, { useClass: DiscordSourceAdapter })
container.register(TOKENS.SummaryPresenter, {
  useClass: DiscordSummaryPresenter,
})

// Stub GitHub source (TODO: replace with real adapter)
container.register(TOKENS.GitHubSource, {
  useValue: {
    getIssues: async () => [],
    getProjectActivities: async () => [],
  },
})

// Use Cases — 透過 factory 組裝 deps，Use Case 不依賴 DI
container.register(GenerateSummary, {
  useFactory: (c) =>
    new GenerateSummary({
      github: c.resolve(TOKENS.GitHubSource),
      discord: c.resolve(TOKENS.DiscordSource),
      conversationGrouper: c.resolve(TOKENS.ConversationGrouper),
      actionItemGenerator: c.resolve(TOKENS.ActionItemGenerator),
    }),
})

export { container }
