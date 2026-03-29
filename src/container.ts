import 'reflect-metadata'
import { container } from 'tsyringe'
import { env } from 'cloudflare:workers'
import { App } from 'octokit'
import { TOKENS } from './tokens'
import { KVMemoryStoreAdapter } from './adapters/kv-memory-store'
import { AIServiceAdapter } from './adapters/ai-service'
import { DiscordNotifierAdapter } from './adapters/discord-notifier'
import { DiscordSourceAdapter } from './adapters/discord-source'
import { DiscordSummaryPresenter } from './adapters/discord-summary-presenter'
import { GitHubSourceAdapter } from './adapters/github-source'
import { GenerateSummary } from './usecases/generate-summary'

// Env bindings
container.register(TOKENS.DiscordBotToken, { useValue: env.DISCORD_BOT_TOKEN })
container.register(TOKENS.DiscordChannelId, {
  useValue: env.DISCORD_CHANNEL_ID,
})
container.register(TOKENS.CfAccountId, { useValue: env.CF_ACCOUNT_ID })
container.register(TOKENS.CfAigToken, { useValue: env.CF_AIG_TOKEN })
container.register(TOKENS.AiGatewayId, { useValue: env.AI_GATEWAY_ID })
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

// GitHub source — App auth + GraphQL, lazy-init installation Octokit
container.register(TOKENS.GitHubOrg, { useValue: env.GITHUB_ORG })
container.register(TOKENS.GitHubProjectNumber, {
  useValue: Number(env.GITHUB_PROJECT_NUMBER),
})
container.register(TOKENS.GitHubSource, {
  useFactory: (c) => {
    const app = new App({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_PRIVATE_KEY,
    })
    let octokitPromise: ReturnType<typeof app.getInstallationOctokit> | null =
      null
    const graphql = async <T = unknown>(
      query: string,
      variables?: Record<string, unknown>,
    ): Promise<T> => {
      if (!octokitPromise) {
        octokitPromise = app.getInstallationOctokit(
          Number(env.GITHUB_INSTALLATION_ID),
        )
      }
      const octokit = await octokitPromise
      return octokit.graphql<T>(query, variables)
    }
    return new GitHubSourceAdapter(
      graphql,
      c.resolve(TOKENS.GitHubOrg),
      c.resolve(TOKENS.GitHubProjectNumber),
    )
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
