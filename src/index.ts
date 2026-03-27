import { Hono } from 'hono'
import { GenerateSummary } from './usecases/generate-summary'
import { createScheduledHandler } from './adapters/scheduled-handler'
import { DiscordNotifierAdapter } from './adapters/discord-notifier'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// TODO: replace remaining stubs with real adapter implementations
const scheduledHandler = createScheduledHandler((env) => ({
  usecase: new GenerateSummary({
    github: {
      getIssues: async () => [],
      getProjectActivities: async () => [],
    },
    discord: {
      getChannelMessages: async () => [],
    },
    ai: {
      generateSummary: async () => '',
    },
    notifier: new DiscordNotifierAdapter(env.DISCORD_BOT_TOKEN),
  }),
  channelId: env.DISCORD_CHANNEL_ID,
  hours: Number(env.SUMMARY_HOURS),
}))

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
