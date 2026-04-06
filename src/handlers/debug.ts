import { SpanStatusCode, type Tracer } from '@opentelemetry/api'
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
  const trace = setupTrace(child, {})

  const usecase = child.resolve(GenerateSummary)
  const hours = Number(c.req.query('hours')) || Number(c.env.SUMMARY_HOURS)

  const run = async () => {
    try {
      const result = await usecase.execute(hours)
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: message }, 500)
    }
  }

  if (trace) {
    const tracer = child.resolve<Tracer>(TOKENS.Tracer)
    const traceInput = { channelId, debug: true }
    return tracer.startActiveSpan(
      'generate-summary',
      {
        attributes: {
          channelId,
          debug: 'true',
          'langfuse.trace.input': JSON.stringify(traceInput),
        },
      },
      async (span) => {
        try {
          const response = await run()
          span.setStatus({ code: SpanStatusCode.OK })
          return response
        } catch (error) {
          span.recordException(error as Error)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message,
          })
          throw error
        } finally {
          span.end()
          await trace.provider.forceFlush()
        }
      },
    )
  }

  return run()
})

export default debug
