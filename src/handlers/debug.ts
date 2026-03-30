import { Hono } from 'hono'
import { container } from '../container'
import { TOKENS, type LangfuseConfig } from '../tokens'
import type { RequestContext } from '../context'
import { createTelemetryContext } from '../telemetry/context'
import { GenerateSummary } from '../usecases/generate-summary'

const debug = new Hono<{ Bindings: Env }>()

debug.get('/summary', async (c) => {
  const channelId = c.req.query('channel_id')
  if (!channelId) {
    return c.json({ error: 'channel_id is required' }, 400)
  }

  const child = container.createChildContainer()
  child.register(TOKENS.DiscordChannelId, { useValue: channelId })

  const config = child.resolve<LangfuseConfig | null>(TOKENS.LangfuseConfig)
  const { tracer } = createTelemetryContext(config)
  const ctx: RequestContext = {}
  if (tracer) {
    ctx.traceId = tracer.createTrace({
      name: 'generate-summary',
      input: { channelId, debug: true },
    })
  }
  child.register(TOKENS.RequestContext, { useValue: ctx })

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
