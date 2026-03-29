import { http, HttpResponse } from 'msw'
import { describe, it, expect } from 'vitest'
import { DiscordNotifierAdapter } from '../../src/adapters/discord-notifier'
import { server } from '../msw-server'

const MESSAGES_URL = 'https://discord.com/api/v10/channels/123456/messages'

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

  it('should throw error when API returns non-ok response', async () => {
    server.use(
      http.post(MESSAGES_URL, () => {
        return new HttpResponse(null, {
          status: 403,
          statusText: 'Forbidden',
        })
      }),
    )

    const notifier = new DiscordNotifierAdapter('test-bot-token')

    await expect(notifier.sendMessage('123456', 'Hello')).rejects.toThrowError(
      'Discord API error: 403 Forbidden',
    )
  })
})
