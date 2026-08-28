import './container'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import health from './handlers/health'
import { MCP_ROUTE, mcpApiHandler } from './handlers/mcp'
import { scheduledHandler } from './handlers/scheduled'

const app = new Hono<{ Bindings: Env }>()

app.route('/', health)

if (env.DEBUG_MODE === 'true') {
  const debug = (await import('./handlers/debug')).default
  app.route('/debug', debug)
}

const oauth = new OAuthProvider({
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  apiRoute: MCP_ROUTE,
  apiHandler: mcpApiHandler,
  defaultHandler: app,
})

// OAuthProvider supplies only `fetch`, so the cron entry point is re-attached here.
export default {
  fetch: (request: Request, workerEnv: Env, ctx: ExecutionContext) =>
    oauth.fetch(request, workerEnv, ctx),
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
