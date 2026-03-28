import { Hono } from 'hono'
import { GenerateSummary } from './usecases/generate-summary'
import { createScheduledHandler } from './handlers/scheduled'
import { DiscordNotifierAdapter } from './adapters/discord-notifier'
import { DiscordSourceAdapter } from './adapters/discord-source'
import { AIServiceAdapter } from './adapters/ai-service'
import health from './handlers/health'

const app = new Hono<{ Bindings: Env }>()

app.route('/', health)

// TODO: replace GitHub stub with real adapter implementation
const scheduledHandler = createScheduledHandler((env) => ({
  usecase: new GenerateSummary({
    github: {
      getIssues: async () => [],
      getProjectActivities: async () => [],
    },
    discord: new DiscordSourceAdapter(
      env.DISCORD_BOT_TOKEN,
      env.DISCORD_CHANNEL_ID,
    ),
    ai: new AIServiceAdapter(env.CF_AIG_TOKEN, env.AI_MODEL),
    notifier: new DiscordNotifierAdapter(env.DISCORD_BOT_TOKEN),
  }),
  channelId: env.DISCORD_CHANNEL_ID,
  hours: Number(env.SUMMARY_HOURS),
}))

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
