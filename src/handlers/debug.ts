import { Hono } from 'hono'
import type { PreviewSummary } from '../usecases/preview-summary'

export interface DebugHandlerConfig {
  usecase: PreviewSummary
  defaultHours: number
}

export type DebugConfigFactory = (
  env: Env,
  channelId: string,
) => DebugHandlerConfig

export function createDebugHandler(factory: DebugConfigFactory) {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/summary', async (c) => {
    const channelId = c.req.query('channel_id')
    if (!channelId) {
      return c.json({ error: 'channel_id is required' }, 400)
    }

    const { usecase, defaultHours } = factory(c.env, channelId)
    const hours = Number(c.req.query('hours')) || defaultHours

    try {
      const result = await usecase.execute(hours)
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: message }, 500)
    }
  })

  return app
}
