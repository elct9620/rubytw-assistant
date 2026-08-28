import { Hono } from 'hono'
import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'
import { ConsentPage } from './consent-page'
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

authorize.get('/authorize', async (c) => {
  let authRequest: AuthRequest
  try {
    authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      throw error
    }
    // RFC 6749 §4.1.2.1: an unusable redirect target must be shown to the
    // visitor, never followed — sending the error there would hand it to
    // whoever supplied the bad address.
    if (!error.redirectUri) {
      return c.text(`${error.code}: ${error.description}`, 400)
    }
    const back = new URL(error.redirectUri)
    back.searchParams.set('error', error.code)
    back.searchParams.set('error_description', error.description)
    if (error.state) back.searchParams.set('state', error.state)
    if (error.issuer) back.searchParams.set('iss', error.issuer)
    return c.redirect(back.toString(), 302)
  }

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
  return c.html(
    ConsentPage({
      client,
      user,
      scopes: authRequest.scope,
      approval,
      action: APPROVE_PATH,
    }),
  )
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

  // Declining spends the approval too, so a page left open cannot be
  // completed later by someone else at the same screen.
  if (form.get('decision') !== 'approve') {
    return c.text('Authorization declined', 200)
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
