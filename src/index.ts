import './container'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { OAuthError, OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { container } from './container'
import { TOKENS } from './tokens'
import type { GuildRoleChecker } from './usecases/ports'
import authorize from './handlers/authorize'
import health from './handlers/health'
import { MCP_ROUTE, mcpApiHandler } from './handlers/mcp'
import { scheduledHandler } from './handlers/scheduled'

const app = new Hono<{ Bindings: Env }>()

app.route('/', health)
app.route('/', authorize)

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
  // The role is checked once at authorization, but a grant outlives that by
  // 30 days. Re-checking on refresh caps how long a revoked operator keeps
  // access at the access token's own lifetime.
  tokenExchangeCallback: async ({ grantType, userId }) => {
    if (grantType !== 'refresh_token') {
      return
    }
    const roles = container.resolve<GuildRoleChecker>(TOKENS.GuildRoleChecker)
    if (await roles.hasOperatorRole(userId)) {
      return
    }
    throw new OAuthError('invalid_grant', {
      description: 'This Discord account is no longer a Ruby Taiwan operator',
    })
  },
})

// OAuthProvider supplies only `fetch`, so the cron entry point is re-attached here.
export default {
  fetch: (request: Request, workerEnv: Env, ctx: ExecutionContext) =>
    oauth.fetch(request, workerEnv, ctx),
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>
