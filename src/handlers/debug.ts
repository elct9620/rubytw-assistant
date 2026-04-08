import { Hono } from 'hono'
import { container } from '../container'
import { TOKENS } from '../tokens'
import { GenerateSummary } from '../usecases/generate-summary'
import type { SummaryResult } from '../usecases/ports'
import { runWithTrace, setupTrace } from './telemetry-setup'

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

  try {
    const result = await runWithTrace(child, trace, {
      spanName: 'generate-summary',
      input: { channelId, hours, debug: true },
      summarizeOutput: (r: SummaryResult) => ({
        topicGroupCount: r.topicGroups.length,
        actionItemCount: r.actionItems.length,
      }),
      fn: () => usecase.execute(hours),
    })
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default debug
