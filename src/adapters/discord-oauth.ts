import { injectable, inject } from 'tsyringe'
import type {
  DiscordIdentity,
  DiscordIdentityProvider,
} from '../usecases/ports'
import { assertDiscordResponse } from './shared'
import { TOKENS } from '../tokens'

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const CURRENT_USER_URL = 'https://discord.com/api/v10/users/@me'

/** Membership is read with the bot token, so consent stays at `identify`. */
const SCOPE = 'identify'

interface DiscordTokenResponse {
  access_token: string
}

interface DiscordUser {
  id: string
  username: string
  global_name: string | null
}

@injectable()
export class DiscordOAuthAdapter implements DiscordIdentityProvider {
  constructor(
    @inject(TOKENS.DiscordClientId) private clientId: string,
    @inject(TOKENS.DiscordClientSecret) private clientSecret: string,
  ) {}

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', SCOPE)
    url.searchParams.set('state', state)
    return url.toString()
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<DiscordIdentity> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })
    await assertDiscordResponse(tokenResponse)
    const { access_token: accessToken } =
      (await tokenResponse.json()) as DiscordTokenResponse

    const userResponse = await fetch(CURRENT_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    await assertDiscordResponse(userResponse)
    const user = (await userResponse.json()) as DiscordUser

    return { userId: user.id, username: user.global_name ?? user.username }
  }
}
