import { Hono } from 'hono'
import { html } from 'hono/html'
import type {
  AuthRequest,
  ClientInfo,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'
import { container } from '../container'
import { TOKENS } from '../tokens'
import type {
  DiscordIdentity,
  DiscordIdentityProvider,
  GuildRoleChecker,
  LoginStateStore,
} from '../usecases/ports'

export const CALLBACK_PATH = '/oauth/callback'
export const APPROVE_PATH = '/authorize/approve'

type AuthBindings = Env & { OAUTH_PROVIDER: OAuthHelpers }

/** Waiting for the operator's answer, after Discord has already vouched for them. */
interface PendingApproval {
  authRequest: AuthRequest
  user: DiscordIdentity
}

const authorize = new Hono<{ Bindings: AuthBindings }>()

const stateStore = () =>
  container.resolve<LoginStateStore>(TOKENS.LoginStateStore)
const identityProvider = () =>
  container.resolve<DiscordIdentityProvider>(TOKENS.DiscordIdentityProvider)

const callbackUri = (requestUrl: string): string =>
  new URL(CALLBACK_PATH, requestUrl).toString()

const consentPage = (
  client: ClientInfo | null,
  user: DiscordIdentity,
  approval: string,
) =>
  html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Authorize MCP client</title>
      </head>
      <body>
        <h1>Authorize MCP client</h1>
        <p>
          Signed in as <strong>${user.username}</strong>.
          <strong>${client?.clientName ?? 'An unnamed client'}</strong> is
          asking to manage Ruby Taiwan assistant data on your behalf.
        </p>
        <p>Only approve this if you started it yourself.</p>
        <form method="post" action="${APPROVE_PATH}">
          <input type="hidden" name="approval" value="${approval}" />
          <button type="submit">Approve</button>
        </form>
      </body>
    </html>`

authorize.get('/authorize', async (c) => {
  const authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  const state = await stateStore().issue(authRequest)
  return c.redirect(
    identityProvider().authorizeUrl(callbackUri(c.req.url), state),
    302,
  )
})

authorize.get(CALLBACK_PATH, async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return c.text('Missing code or state', 400)
  }

  const authRequest = await stateStore().consume<AuthRequest>(state)
  if (!authRequest) {
    return c.text('Login attempt expired or already used', 400)
  }

  const user = await identityProvider().exchangeCode(
    code,
    callbackUri(c.req.url),
  )

  const roles = container.resolve<GuildRoleChecker>(TOKENS.GuildRoleChecker)
  if (!(await roles.hasOperatorRole(user.userId))) {
    return c.text('This Discord account is not a Ruby Taiwan operator', 403)
  }

  // The client is named to the operator before the grant exists, so a login
  // someone else started cannot be turned into a grant by a single click.
  const approval = await stateStore().issue({ authRequest, user })
  const client = await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId)
  return c.html(consentPage(client, user, approval))
})

authorize.post(APPROVE_PATH, async (c) => {
  const form = await c.req.formData()
  const approval = form.get('approval')
  if (typeof approval !== 'string') {
    return c.text('Missing approval', 400)
  }

  const pending = await stateStore().consume<PendingApproval>(approval)
  if (!pending) {
    return c.text('Approval expired or already used', 400)
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.authRequest,
    userId: pending.user.userId,
    metadata: { label: pending.user.username },
    scope: pending.authRequest.scope,
    props: pending.user,
  })

  return c.redirect(redirectTo, 302)
})

export default authorize
