import { Hono } from 'hono'
import { container } from '../container'
import { TOKENS } from '../tokens'
import { GenerateSummary } from '../usecases/generate-summary'
import { runWithTrace, setupTrace } from './telemetry-setup'
import { summarizeResult } from './summarize-result'

const debug = new Hono<{ Bindings: Env }>()

// Defence in depth: debug endpoints are developer-only. Even when
// DEBUG_MODE is accidentally enabled in production, reject requests that
// do not originate from localhost (wrangler dev serves on localhost).
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

debug.use('*', async (c, next) => {
  const { hostname } = new URL(c.req.url)
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    return c.notFound()
  }
  return next()
})

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

  try {
    const result = await runWithTrace(child, trace, {
      spanName: 'generate-summary',
      input: { channelId, hours, debug: true },
      summarizeOutput: summarizeResult,
      fn: () => usecase.execute(hours),
    })
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default debug
