import './container'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import health from './handlers/health'
import { scheduledHandler } from './handlers/scheduled'

const app = new Hono<{ Bindings: Env }>()

app.route('/', health)

if (env.DEBUG_MODE === 'true') {
  const debug = (await import('./handlers/debug')).default
  app.route('/debug', debug)
}

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
