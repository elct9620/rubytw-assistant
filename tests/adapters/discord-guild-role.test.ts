import { http, HttpResponse } from 'msw'
import { describe, it, expect, beforeEach } from 'vitest'
import { DiscordGuildRoleAdapter } from '../../src/adapters/discord-guild-role'
import { network } from '../msw-server'

const GUILD_ID = '900000000000000001'
const OPERATOR_ROLE_ID = '900000000000000002'
const USER_ID = '900000000000000003'
const MEMBER_URL = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${USER_ID}`

const createAdapter = () =>
  new DiscordGuildRoleAdapter('test-bot-token', GUILD_ID, OPERATOR_ROLE_ID)

beforeEach(() => {})

describe('DiscordGuildRoleAdapter', () => {
  it('should grant when the member carries the operator role', async () => {
    let capturedAuth: string | undefined

    network.use(
      http.get(MEMBER_URL, ({ request }) => {
        capturedAuth = request.headers.get('Authorization') ?? undefined
        return HttpResponse.json({
          roles: ['800000000000000000', OPERATOR_ROLE_ID],
        })
      }),
    )

    await expect(createAdapter().hasOperatorRole(USER_ID)).resolves.toBe(true)
    expect(capturedAuth).toBe('Bot test-bot-token')
  })

  it('should deny when the member lacks the operator role', async () => {
    network.use(
      http.get(MEMBER_URL, () =>
        HttpResponse.json({ roles: ['800000000000000000'] }),
      ),
    )

    await expect(createAdapter().hasOperatorRole(USER_ID)).resolves.toBe(false)
  })

  it('should deny when the user never joined the guild', async () => {
    network.use(
      http.get(MEMBER_URL, () =>
        HttpResponse.json(
          { message: 'Unknown Member', code: 10007 },
          { status: 404 },
        ),
      ),
    )

    await expect(createAdapter().hasOperatorRole(USER_ID)).resolves.toBe(false)
  })

  it('should refuse to answer when Discord cannot be reached', async () => {
    network.use(
      http.get(MEMBER_URL, () =>
        HttpResponse.json(
          { message: 'Internal Server Error' },
          { status: 500 },
        ),
      ),
    )

    await expect(createAdapter().hasOperatorRole(USER_ID)).rejects.toThrow(
      /Discord API error: 500/,
    )
  })
})
