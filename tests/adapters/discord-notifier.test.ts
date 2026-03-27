import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscordNotifierAdapter } from '../../src/adapters/discord-notifier'

describe('DiscordNotifierAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  it('should send message to correct Discord API endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const notifier = new DiscordNotifierAdapter('test-bot-token', fetchMock)

    await notifier.sendMessage('123456', 'Hello Discord')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/123456/messages',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bot test-bot-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Hello Discord' }),
      },
    )
  })

  it('should throw error when API returns non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    })
    const notifier = new DiscordNotifierAdapter('test-bot-token', fetchMock)

    await expect(notifier.sendMessage('123456', 'Hello')).rejects.toThrowError(
      'Discord API error: 403 Forbidden',
    )
  })
})
