import { Hono } from 'hono'
import { GenerateSummary } from './usecases/generate-summary'
import { createScheduledHandler } from './adapters/scheduled-handler'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// TODO: replace stubs with real adapter implementations
const scheduledHandler = createScheduledHandler(() => ({
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
    notifier: {
      sendMessage: async () => {},
    },
  }),
  channelId: '',
  hours: 24,
}))

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
