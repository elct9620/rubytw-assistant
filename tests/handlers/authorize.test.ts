import { env } from 'cloudflare:workers'
import { http, HttpResponse } from 'msw'
import { describe, it, expect, beforeEach } from 'vitest'
import { container } from 'tsyringe'
import { TOKENS } from '../../src/tokens'
import { server } from '../msw-server'
import worker from '../../src/index'

const GUILD_ID = '900000000000000001'
const OPERATOR_ROLE_ID = '900000000000000002'
const USER_ID = '900000000000000003'
const CLIENT_REDIRECT = 'http://client.example/callback'

const ctx = {} as ExecutionContext
const call = (request: Request) => worker.fetch!(request, env, ctx)

const mockDiscord = ({ roles }: { roles: string[] }) => {
  server.use(
    http.post('https://discord.com/api/oauth2/token', () =>
      HttpResponse.json({ access_token: 'discord-user-token' }),
    ),
    http.get('https://discord.com/api/v10/users/@me', () =>
      HttpResponse.json({
        id: USER_ID,
        username: 'operator',
        global_name: 'Operator',
      }),
    ),
    http.get(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${USER_ID}`,
      () => HttpResponse.json({ roles }),
    ),
  )
}

const registerClient = async (): Promise<string> => {
  const res = await call(
    new Request('http://localhost/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test MCP Client',
        redirect_uris: [CLIENT_REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as { client_id: string }
  return body.client_id
}

const CODE_VERIFIER = 'a'.repeat(64)

const codeChallenge = async (): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(CODE_VERIFIER),
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Drives /authorize and returns the `state` handed to Discord. */
const startLogin = async (clientId: string): Promise<string> => {
  const url = new URL('http://localhost/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', CLIENT_REDIRECT)
  url.searchParams.set('scope', 'mcp')
  url.searchParams.set('state', 'client-state')
  url.searchParams.set('code_challenge', await codeChallenge())
  url.searchParams.set('code_challenge_method', 'S256')

  const res = await call(new Request(url))
  expect(res.status).toBe(302)

  const location = new URL(res.headers.get('Location')!)
  expect(location.origin).toBe('https://discord.com')
  expect(location.searchParams.get('scope')).toBe('identify')
  return location.searchParams.get('state')!
}

beforeEach(() => {
  container.clearInstances()
  container.register(TOKENS.DiscordGuildId, { useValue: GUILD_ID })
  container.register(TOKENS.DiscordOperatorRoleId, {
    useValue: OPERATOR_ROLE_ID,
  })
  container.register(TOKENS.DiscordClientId, { useValue: 'discord-client-id' })
  container.register(TOKENS.DiscordClientSecret, { useValue: 'discord-secret' })
  container.register(TOKENS.OAuthKv, { useValue: env.OAUTH_KV })
  container.register(TOKENS.DiscordBotToken, { useValue: 'test-bot-token' })
})

/** Returns the approval token the consent page hands the operator. */
const finishDiscordLogin = async (state: string): Promise<string> => {
  const res = await call(
    new Request(
      `http://localhost/oauth/callback?code=discord-code&state=${state}`,
    ),
  )
  expect(res.status).toBe(200)
  const page = await res.text()
  return /name="approval" value="([^"]+)"/.exec(page)![1]
}

const approve = (approval: string) =>
  call(
    new Request('http://localhost/authorize/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ approval, decision: 'approve' }),
    }),
  )

describe('an operator signing an MCP client in with Discord', () => {
  it('should end up holding a token that reaches the MCP server', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const state = await startLogin(clientId)
    const approval = await finishDiscordLogin(state)

    const callback = await approve(approval)
    expect(callback.status).toBe(302)

    const back = new URL(callback.headers.get('Location')!)
    expect(back.origin + back.pathname).toBe(CLIENT_REDIRECT)
    expect(back.searchParams.get('state')).toBe('client-state')

    const tokenRes = await call(
      new Request('http://localhost/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: back.searchParams.get('code')!,
          client_id: clientId,
          redirect_uri: CLIENT_REDIRECT,
          code_verifier: CODE_VERIFIER,
        }),
      }),
    )
    expect(tokenRes.status).toBe(200)
    const { access_token: accessToken } = (await tokenRes.json()) as {
      access_token: string
    }

    const mcpRes = await call(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          // Constructed Requests carry no Host; the MCP handler needs one for
          // its DNS-rebinding check.
          Host: 'localhost',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      }),
    )
    expect(mcpRes.status).toBe(200)
  })
})

describe('an authorization request the provider rejects', () => {
  it('should answer the visitor rather than fail, when the redirect is unusable', async () => {
    const clientId = await registerClient()
    const url = new URL('http://localhost/authorize')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', 'https://evil.example/cb')
    url.searchParams.set('scope', 'mcp')
    url.searchParams.set('state', 'client-state')

    const res = await call(new Request(url))

    expect(res.status).toBe(400)
    expect(res.headers.get('Location')).toBeNull()
    expect(await res.text()).toContain('invalid_request')
  })

  it('should not start a Discord login for a request it rejected', async () => {
    const url = new URL('http://localhost/authorize')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', 'never-registered')
    url.searchParams.set('redirect_uri', CLIENT_REDIRECT)
    url.searchParams.set('scope', 'mcp')

    const res = await call(new Request(url))

    expect(res.status).toBe(400)
    expect(res.headers.get('Location')).toBeNull()
  })
})

describe('a Discord account without the operator role', () => {
  it('should be refused before any grant is created', async () => {
    mockDiscord({ roles: ['800000000000000000'] })
    const clientId = await registerClient()
    const state = await startLogin(clientId)

    const callback = await call(
      new Request(
        `http://localhost/oauth/callback?code=discord-code&state=${state}`,
      ),
    )

    expect(callback.status).toBe(403)
    expect(callback.headers.get('Location')).toBeNull()
  })
})

describe('a login state that comes back twice', () => {
  it('should be honoured only once', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const state = await startLogin(clientId)
    const replay = () =>
      call(
        new Request(
          `http://localhost/oauth/callback?code=discord-code&state=${state}`,
        ),
      )

    expect((await replay()).status).toBe(200)
    expect((await replay()).status).toBe(400)
  })
})

describe('an approval nobody was handed', () => {
  it('should not create a grant', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    await registerClient()

    const res = await approve(crypto.randomUUID())

    expect(res.status).toBe(400)
    expect(res.headers.get('Location')).toBeNull()
  })

  it('should not create a second grant when replayed', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const approval = await finishDiscordLogin(await startLogin(clientId))

    expect((await approve(approval)).status).toBe(302)
    expect((await approve(approval)).status).toBe(400)
  })
})

describe('the consent page', () => {
  it('should name the client that is asking', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const state = await startLogin(clientId)

    const res = await call(
      new Request(
        `http://localhost/oauth/callback?code=discord-code&state=${state}`,
      ),
    )

    expect(await res.text()).toContain('Test MCP Client')
  })
})

/** Walks the whole login and returns the tokens the client ends up with. */
const signIn = async (): Promise<{
  clientId: string
  accessToken: string
  refreshToken: string
}> => {
  const clientId = await registerClient()
  const approval = await finishDiscordLogin(await startLogin(clientId))
  const callback = await approve(approval)
  const back = new URL(callback.headers.get('Location')!)

  const tokenRes = await call(
    new Request('http://localhost/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: back.searchParams.get('code')!,
        client_id: clientId,
        redirect_uri: CLIENT_REDIRECT,
        code_verifier: CODE_VERIFIER,
      }),
    }),
  )
  const body = (await tokenRes.json()) as {
    access_token: string
    refresh_token: string
  }
  return {
    clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  }
}

const refresh = (clientId: string, refreshToken: string) =>
  call(
    new Request('http://localhost/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    }),
  )

describe('an operator who loses the role after signing in', () => {
  it('should still be able to refresh while the role is held', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const { clientId, refreshToken } = await signIn()

    expect((await refresh(clientId, refreshToken)).status).toBe(200)
  })

  it('should be cut off at the next refresh once the role is gone', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const { clientId, refreshToken } = await signIn()

    mockDiscord({ roles: [] })
    const res = await refresh(clientId, refreshToken)

    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({
      error: 'invalid_grant',
    })
  })
})

describe('an operator who declines', () => {
  it('should get no grant, and no second chance at the same screen', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const approval = await finishDiscordLogin(await startLogin(clientId))

    const declined = await call(
      new Request('http://localhost/authorize/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ approval, decision: 'deny' }),
      }),
    )

    expect(declined.status).toBe(200)
    expect(declined.headers.get('Location')).toBeNull()
    expect((await approve(approval)).status).toBe(400)
  })
})

describe('the consent page', () => {
  it('should carry its stylesheet into the page', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const state = await startLogin(clientId)

    const page = await (
      await call(
        new Request(
          `http://localhost/oauth/callback?code=discord-code&state=${state}`,
        ),
      )
    ).text()

    expect(page).toContain('<style id="hono-css">')
    expect(page).toContain('prefers-color-scheme:dark')
    expect(page).toMatch(/<body class="css-\d+"/)
  })

  it('should show the address this request uses, not the first one registered', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const decoy = 'http://decoy.example/callback'
    const registered = await call(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Two Address Client',
          redirect_uris: [decoy, CLIENT_REDIRECT],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        }),
      }),
    )
    const { client_id: clientId } = (await registered.json()) as {
      client_id: string
    }

    const url = new URL('http://localhost/authorize')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', CLIENT_REDIRECT)
    url.searchParams.set('scope', 'mcp')
    url.searchParams.set('state', 'client-state')
    url.searchParams.set('code_challenge', await codeChallenge())
    url.searchParams.set('code_challenge_method', 'S256')
    const started = await call(new Request(url))
    const state = new URL(started.headers.get('Location')!).searchParams.get(
      'state',
    )!

    const page = await (
      await call(
        new Request(
          `http://localhost/oauth/callback?code=discord-code&state=${state}`,
        ),
      )
    ).text()

    expect(page).toContain(CLIENT_REDIRECT)
    expect(page).not.toContain(decoy)
  })

  it('should show where the authorization code would be sent', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const clientId = await registerClient()
    const state = await startLogin(clientId)

    const res = await call(
      new Request(
        `http://localhost/oauth/callback?code=discord-code&state=${state}`,
      ),
    )

    expect(await res.text()).toContain(CLIENT_REDIRECT)
  })

  it('should not let a client name carry markup into the page', async () => {
    mockDiscord({ roles: [OPERATOR_ROLE_ID] })
    const res = await call(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: '<script>alert(1)</script>',
          redirect_uris: [CLIENT_REDIRECT],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        }),
      }),
    )
    const { client_id: clientId } = (await res.json()) as { client_id: string }

    const page = await call(
      new Request(
        `http://localhost/oauth/callback?code=discord-code&state=${await startLogin(clientId)}`,
      ),
    )

    expect(await page.text()).not.toContain('<script>alert(1)</script>')
  })
})
