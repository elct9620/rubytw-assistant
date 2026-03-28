import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { GenerateSummary } from './usecases/generate-summary'
import { PreviewSummary } from './usecases/preview-summary'
import { createScheduledHandler } from './handlers/scheduled'
import { createDebugHandler } from './handlers/debug'
import { DiscordNotifierAdapter } from './adapters/discord-notifier'
import { DiscordSourceAdapter } from './adapters/discord-source'
import { AIServiceAdapter } from './adapters/ai-service'
import { KVMemoryStoreAdapter } from './adapters/kv-memory-store'
import health from './handlers/health'

const app = new Hono<{ Bindings: Env }>()

app.route('/', health)

if ((env.DEBUG as string) === 'true') {
  const debugHandler = createDebugHandler((e, channelId) => {
    const memoryEntryLimit = Number(e.MEMORY_ENTRY_LIMIT)
    const memoryStore = new KVMemoryStoreAdapter(e.MEMORY_KV, memoryEntryLimit)
    const aiAdapter = new AIServiceAdapter(
      e.CF_AIG_TOKEN,
      e.AI_MODEL,
      memoryStore,
      memoryEntryLimit,
    )

    return {
      usecase: new PreviewSummary({
        discord: new DiscordSourceAdapter(e.DISCORD_BOT_TOKEN, channelId),
        conversationGrouper: aiAdapter,
        actionItemGenerator: aiAdapter,
      }),
      defaultHours: Number(e.SUMMARY_HOURS),
    }
  })
  app.route('/debug', debugHandler)
}

// TODO: replace GitHub stub with real adapter implementation
const scheduledHandler = createScheduledHandler((env) => {
  const memoryEntryLimit = Number(env.MEMORY_ENTRY_LIMIT)
  const memoryStore = new KVMemoryStoreAdapter(env.MEMORY_KV, memoryEntryLimit)
  const aiAdapter = new AIServiceAdapter(
    env.CF_AIG_TOKEN,
    env.AI_MODEL,
    memoryStore,
    memoryEntryLimit,
  )

  return {
    usecase: new GenerateSummary({
      github: {
        getIssues: async () => [],
        getProjectActivities: async () => [],
      },
      discord: new DiscordSourceAdapter(
        env.DISCORD_BOT_TOKEN,
        env.DISCORD_CHANNEL_ID,
      ),
      conversationGrouper: aiAdapter,
      actionItemGenerator: aiAdapter,
      notifier: new DiscordNotifierAdapter(env.DISCORD_BOT_TOKEN),
    }),
    channelId: env.DISCORD_CHANNEL_ID,
    hours: Number(env.SUMMARY_HOURS),
  }
})

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
