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

  if (trace) {
    const tracer = child.resolve<Tracer>(TOKENS.Tracer)
    // Use `langfuse.observation.*` so the root observation's input/output is
    // rendered in the Langfuse v4 Fast UI. See scheduled.ts for the rationale.
    const observationInput = { channelId, hours, debug: true }
    return tracer.startActiveSpan(
      'generate-summary',
      {
        attributes: {
          'langfuse.observation.input': JSON.stringify(observationInput),
        },
      },
      async (span) => {
        try {
          const result = await usecase.execute(hours)
          span.setAttribute(
            'langfuse.observation.output',
            JSON.stringify({
              topicGroupCount: result.topicGroups.length,
              actionItemCount: result.actionItems.length,
            }),
          )
          return c.json(result)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          span.recordException(err)
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
          span.setAttribute(
            'langfuse.observation.output',
            JSON.stringify({ error: err.message, stack: err.stack }),
          )
          return c.json({ error: err.message }, 500)
        } finally {
          span.end()
          await trace.provider.forceFlush()
        }
      },
    )
  }

  try {
    const result = await usecase.execute(hours)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default debug
