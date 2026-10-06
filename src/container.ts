import 'reflect-metadata'
import { container, Lifecycle } from 'tsyringe'
import { env } from 'cloudflare:workers'
import { Octokit } from '@octokit/core'
import { createAppAuth } from '@octokit/auth-app'
import { TOKENS } from './tokens'
import { KVMemoryStoreAdapter } from './adapters/kv-memory-store'
import { KVMemorySummaryStoreAdapter } from './adapters/kv-memory-summary-store'
import { createAITools, type AIToolsDeps } from './services/ai-tools'
import { FollowUpAgentService } from './services/follow-up-agent'
import { MemoryAgentService } from './services/memory-agent'
import { DiscordNotifierAdapter } from './adapters/discord-notifier'
import { DiscordGuildRoleAdapter } from './adapters/discord-guild-role'
import { DiscordOAuthAdapter } from './adapters/discord-oauth'
import { KVLoginStateStoreAdapter } from './adapters/kv-login-state-store'
import { DiscordRateLimiter } from './adapters/discord-rate-limit'
import { DiscordSourceAdapter } from './adapters/discord-source'
import { DiscordSummaryPresenter } from './adapters/discord-summary-presenter'
import { GitHubSourceAdapter } from './adapters/github-source'
import { ensurePkcs8 } from './adapters/github-key'
import { GenerateSummary } from './usecases/generate-summary'

// Env bindings
container.register(TOKENS.DiscordBotToken, { useValue: env.DISCORD_BOT_TOKEN })
container.register(TOKENS.DiscordChannelId, {
  useValue: env.DISCORD_CHANNEL_ID,
})
container.register(TOKENS.DiscordGuildId, { useValue: env.DISCORD_GUILD_ID })
container.register(TOKENS.DiscordOperatorRoleId, {
  useValue: env.DISCORD_OPERATOR_ROLE_ID,
})
container.register(TOKENS.AiGatewayConfig, {
  useValue: {
    gateway: env.AI.gateway(env.AI_GATEWAY_ID),
    modelId: env.AI_MODEL,
  },
})
container.register(TOKENS.DiscordClientId, { useValue: env.DISCORD_CLIENT_ID })
container.register(TOKENS.DiscordClientSecret, {
  useValue: env.DISCORD_CLIENT_SECRET,
})
container.register(TOKENS.MemoryKv, { useValue: env.MEMORY_KV })
container.register(TOKENS.OAuthKv, { useValue: env.OAUTH_KV })
container.register(TOKENS.MemoryEntryLimit, {
  useValue: Number(env.MEMORY_ENTRY_LIMIT),
})
container.register(TOKENS.MemoryDescriptionLimit, {
  useValue: Number(env.MEMORY_DESCRIPTION_LIMIT),
})
container.register(TOKENS.MemorySummaryLengthLimit, {
  useValue: Number(env.MEMORY_SUMMARY_LENGTH_LIMIT),
})
container.register(TOKENS.IssueBodyLengthLimit, {
  useValue: Number(env.ISSUE_BODY_LENGTH_LIMIT),
})
container.register(TOKENS.SummaryHours, {
  useValue: Number(env.SUMMARY_HOURS),
})
container.register(TOKENS.SummaryItemLimit, {
  useValue: Number(env.SUMMARY_ITEM_LIMIT),
})
container.register(TOKENS.FollowUpTokenBudget, {
  useValue: Number(env.FOLLOWUP_TOKEN_BUDGET),
})
container.register(TOKENS.GitHubAppId, { useValue: env.GITHUB_APP_ID })
container.register(TOKENS.GitHubPrivateKey, {
  useValue: env.GITHUB_PRIVATE_KEY,
})
container.register(TOKENS.GitHubInstallationId, {
  useValue: env.GITHUB_INSTALLATION_ID,
})

// Langfuse telemetry (optional — keys may be empty strings in local dev)
container.register(TOKENS.LangfuseConfig, {
  useFactory: () =>
    env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
      ? {
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_BASE_URL,
          environment: env.ENVIRONMENT,
        }
      : null,
})

// AI SDK telemetry integration (default: null — no telemetry)
container.register(TOKENS.Telemetry, { useValue: null })

// Port → Adapter mappings (infrastructure)
container.register(TOKENS.MemoryStore, { useClass: KVMemoryStoreAdapter })
container.register(TOKENS.MemorySummaryStore, {
  useClass: KVMemorySummaryStoreAdapter,
})
// Discord's limits follow the bot, so one limiter serves every adapter in an
// invocation; it is never shared across invocations.
container.register(
  TOKENS.DiscordRateLimiter,
  { useClass: DiscordRateLimiter },
  { lifecycle: Lifecycle.ContainerScoped },
)
container.register(TOKENS.DiscordNotifier, { useClass: DiscordNotifierAdapter })
container.register(TOKENS.DiscordSource, { useClass: DiscordSourceAdapter })
container.register(TOKENS.GuildRoleChecker, {
  useClass: DiscordGuildRoleAdapter,
})
container.register(TOKENS.DiscordIdentityProvider, {
  useClass: DiscordOAuthAdapter,
})
container.register(TOKENS.LoginStateStore, {
  useClass: KVLoginStateStoreAdapter,
})
container.register(TOKENS.SummaryPresenter, {
  useClass: DiscordSummaryPresenter,
})

// Factory injection for AI tools. Resolve deps once when the token is
// resolved, then hand out a closure that produces a fresh ToolSet on
// every call — the memory tools rely on a closure-scoped Set to enforce
// "must read before update", and that state must not leak across
// service invocations.
container.register(TOKENS.AIToolsFactory, {
  useFactory: (c) => {
    const deps: AIToolsDeps = {
      memoryStore: c.resolve(TOKENS.MemoryStore),
      githubSource: c.resolve(TOKENS.GitHubSource),
      discordSource: c.resolve(TOKENS.DiscordSource),
      summaryHours: c.resolve(TOKENS.SummaryHours),
      memoryEntryLimit: c.resolve(TOKENS.MemoryEntryLimit),
      memoryDescriptionLimit: c.resolve(TOKENS.MemoryDescriptionLimit),
      issueBodyLengthLimit: c.resolve(TOKENS.IssueBodyLengthLimit),
    }
    return () => createAITools(deps)
  },
})

// Port → Service mappings (orchestration)
container.register(TOKENS.FollowUpAgent, {
  useClass: FollowUpAgentService,
})
container.register(TOKENS.MemoryAgent, {
  useClass: MemoryAgentService,
})

// GitHub source — Octokit with App auth strategy
container.register(TOKENS.GitHubOrg, { useValue: env.GITHUB_ORG })
container.register(TOKENS.GitHubRepo, { useValue: env.GITHUB_REPO })
container.register(TOKENS.GitHubProjectNumber, {
  useValue: Number(env.GITHUB_PROJECT_NUMBER),
})
container.register(TOKENS.GitHubSource, {
  useFactory: (c) => {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: c.resolve<string>(TOKENS.GitHubAppId),
        privateKey: ensurePkcs8(c.resolve<string>(TOKENS.GitHubPrivateKey)),
        installationId: c.resolve<string>(TOKENS.GitHubInstallationId),
      },
    })
    return new GitHubSourceAdapter(
      octokit,
      c.resolve(TOKENS.GitHubOrg),
      c.resolve(TOKENS.GitHubProjectNumber),
      c.resolve(TOKENS.GitHubRepo),
    )
  },
})

// Use Cases — 透過 factory 組裝 deps，Use Case 不依賴 DI
container.register(GenerateSummary, {
  useFactory: (c) =>
    new GenerateSummary({
      discord: c.resolve(TOKENS.DiscordSource),
      followUpAgent: c.resolve(TOKENS.FollowUpAgent),
      memorySummaryStore: c.resolve(TOKENS.MemorySummaryStore),
      memoryAgent: c.resolve(TOKENS.MemoryAgent),
    }),
})

export { container }
