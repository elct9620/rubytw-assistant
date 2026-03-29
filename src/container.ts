import 'reflect-metadata'
import { container } from 'tsyringe'
import { env } from 'cloudflare:workers'
import { Octokit } from '@octokit/core'
import { createAppAuth } from '@octokit/auth-app'
import { TOKENS } from './tokens'
import { KVMemoryStoreAdapter } from './adapters/kv-memory-store'
import { ConversationGrouperService } from './services/conversation-grouper'
import { ActionItemGeneratorService } from './services/action-item-generator'
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
container.register(TOKENS.AiGatewayConfig, {
  useValue: {
    accountId: env.CF_ACCOUNT_ID,
    gatewayId: env.AI_GATEWAY_ID,
    apiKey: env.CF_AIG_TOKEN,
    modelId: env.AI_MODEL,
  },
})
container.register(TOKENS.MemoryKv, { useValue: env.MEMORY_KV })
container.register(TOKENS.MemoryEntryLimit, {
  useValue: Number(env.MEMORY_ENTRY_LIMIT),
})
container.register(TOKENS.SummaryHours, {
  useValue: Number(env.SUMMARY_HOURS),
})
container.register(TOKENS.GitHubAppId, { useValue: env.GITHUB_APP_ID })
container.register(TOKENS.GitHubPrivateKey, {
  useValue: env.GITHUB_PRIVATE_KEY,
})
container.register(TOKENS.GitHubInstallationId, {
  useValue: env.GITHUB_INSTALLATION_ID,
})

// Port → Adapter mappings (infrastructure)
container.register(TOKENS.MemoryStore, { useClass: KVMemoryStoreAdapter })
container.register(TOKENS.DiscordNotifier, { useClass: DiscordNotifierAdapter })
container.register(TOKENS.DiscordSource, { useClass: DiscordSourceAdapter })

// Port → Service mappings (orchestration)
container.register(TOKENS.ConversationGrouper, {
  useClass: ConversationGrouperService,
})
container.register(TOKENS.ActionItemGenerator, {
  useClass: ActionItemGeneratorService,
})
container.register(TOKENS.SummaryPresenter, {
  useClass: DiscordSummaryPresenter,
})

// GitHub source — Octokit with App auth strategy
container.register(TOKENS.GitHubOrg, { useValue: env.GITHUB_ORG })
container.register(TOKENS.GitHubProjectNumber, {
  useValue: Number(env.GITHUB_PROJECT_NUMBER),
})
container.register(TOKENS.GitHubSource, {
  useFactory: (c) => {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: c.resolve<string>(TOKENS.GitHubAppId),
        privateKey: c.resolve<string>(TOKENS.GitHubPrivateKey),
        installationId: c.resolve<string>(TOKENS.GitHubInstallationId),
      },
    })
    return new GitHubSourceAdapter(
      octokit.graphql,
      c.resolve(TOKENS.GitHubOrg),
      c.resolve(TOKENS.GitHubProjectNumber),
    )
  },
})

// Use Cases — 透過 factory 組裝 deps，Use Case 不依賴 DI
container.register(GenerateSummary, {
  useFactory: (c) =>
    new GenerateSummary({
      discord: c.resolve(TOKENS.DiscordSource),
      conversationGrouper: c.resolve(TOKENS.ConversationGrouper),
      actionItemGenerator: c.resolve(TOKENS.ActionItemGenerator),
    }),
})

export { container }
