import { http, HttpResponse } from 'msw'
import { container } from 'tsyringe'
import { describe, it, expect, beforeEach } from 'vitest'
import { DiscordNotifierAdapter } from '../../src/adapters/discord-notifier'
import { TOKENS } from '../../src/tokens'
import { server } from '../msw-server'

const MESSAGES_URL = 'https://discord.com/api/v10/channels/123456/messages'

beforeEach(() => {
  container.clearInstances()
})

describe('DiscordNotifierAdapter', () => {
  it('should send message to correct Discord API endpoint', async () => {
    let capturedAuth: string | undefined
    let capturedBody: { content: string } | undefined
    let capturedContentType: string | undefined

    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        capturedAuth = request.headers.get('Authorization') ?? undefined
        capturedContentType = request.headers.get('Content-Type') ?? undefined
        capturedBody = (await request.json()) as { content: string }
        return HttpResponse.json({})
      }),
    )

    const notifier = new DiscordNotifierAdapter('test-bot-token')
    await notifier.sendMessage('123456', 'Hello Discord')

    expect(capturedAuth).toBe('Bot test-bot-token')
    expect(capturedContentType).toBe('application/json')
    expect(capturedBody).toEqual({ content: 'Hello Discord' })
  })

  it('should throw error with response body when API returns non-ok response', async () => {
    server.use(
      http.post(MESSAGES_URL, () => {
        return HttpResponse.json(
          { code: 50013, message: 'Missing Permissions' },
          { status: 403, statusText: 'Forbidden' },
        )
      }),
    )

    const notifier = new DiscordNotifierAdapter('test-bot-token')

    await expect(notifier.sendMessage('123456', 'Hello')).rejects.toThrow(
      /Discord API error: 403 Forbidden.*Missing Permissions/,
    )
  })

  it('should include Retry-After info on 429 rate limit', async () => {
    server.use(
      http.post(MESSAGES_URL, () => {
        return HttpResponse.json(
          { message: 'You are being rate limited.', retry_after: 1.5 },
          {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Retry-After': '1.5' },
          },
        )
      }),
    )

    const notifier = new DiscordNotifierAdapter('test-bot-token')

    await expect(notifier.sendMessage('123456', 'Hello')).rejects.toThrow(
      /Retry-After: 1\.5/,
    )
  })
})

describe('DiscordNotifierAdapter DI integration', () => {
  it('should resolve from container and send message via Discord API', async () => {
    let capturedBody: { content: string } | undefined

    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        capturedBody = (await request.json()) as { content: string }
        return HttpResponse.json({})
      }),
    )

    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'di-test-token' })
    const notifier = child.resolve(DiscordNotifierAdapter)

    await notifier.sendMessage('123456', 'DI resolved message')

    expect(capturedBody).toEqual({ content: 'DI resolved message' })
  })
})
