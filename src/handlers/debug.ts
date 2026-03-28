import { Hono } from 'hono'
import { container } from '../container'
import { TOKENS } from '../tokens'
import { PreviewSummary } from '../usecases/preview-summary'

const debug = new Hono<{ Bindings: Env }>()

debug.get('/summary', async (c) => {
  const channelId = c.req.query('channel_id')
  if (!channelId) {
    return c.json({ error: 'channel_id is required' }, 400)
  }

  const child = container.createChildContainer()
  child.register(TOKENS.DiscordChannelId, { useValue: channelId })
  const usecase = child.resolve(PreviewSummary)

  const hours = Number(c.req.query('hours')) || Number(c.env.SUMMARY_HOURS)

  try {
    const result = await usecase.execute(hours)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default debug
