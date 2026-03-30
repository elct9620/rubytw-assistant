import { Hono } from 'hono'
import { container } from '../container'
import { TOKENS } from '../tokens'
import { GenerateSummary } from '../usecases/generate-summary'
import { setupTrace } from './telemetry-setup'

const debug = new Hono<{ Bindings: Env }>()

debug.get('/summary', async (c) => {
  const channelId = c.req.query('channel_id')
  if (!channelId) {
    return c.json({ error: 'channel_id is required' }, 400)
  }

  const child = container.createChildContainer()
  child.register(TOKENS.DiscordChannelId, { useValue: channelId })
  const tracer = setupTrace(child, {
    name: 'generate-summary',
    input: { channelId, debug: true },
  })

  const usecase = child.resolve(GenerateSummary)
  const hours = Number(c.req.query('hours')) || Number(c.env.SUMMARY_HOURS)

  try {
    const result = await usecase.execute(hours)
    await tracer?.flush()
    return c.json(result)
  } catch (err) {
    await tracer?.flush()
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default debug
