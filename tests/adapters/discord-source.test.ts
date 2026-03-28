import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiscordSourceAdapter } from '../../src/adapters/discord-source'

const DISCORD_EPOCH = 1420070400000n

function makeMessage(id: string, content: string) {
  return { id, content, author: { username: 'user' }, timestamp: '' }
}

describe('DiscordSourceAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should request messages from correct API endpoint with after snowflake', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    const now = Date.now()
    vi.setSystemTime(now)

    const adapter = new DiscordSourceAdapter(
      'bot-token',
      'channel-123',
      fetchMock,
    )
    await adapter.getChannelMessages(24)

    const expectedSnowflake = String(
      (BigInt(now - 24 * 3600 * 1000) - DISCORD_EPOCH) << 22n,
    )

    expect(fetchMock).toHaveBeenCalledWith(
      `https://discord.com/api/v10/channels/channel-123/messages?after=${expectedSnowflake}&limit=100`,
      {
        headers: {
          Authorization: 'Bot bot-token',
        },
      },
    )
  })

  it('should return message content and filter out empty content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        makeMessage('1', 'hello'),
        makeMessage('2', ''),
        makeMessage('3', 'world'),
      ],
    })

    const adapter = new DiscordSourceAdapter(
      'bot-token',
      'channel-123',
      fetchMock,
    )
    const result = await adapter.getChannelMessages(24)

    expect(result).toEqual(['hello', 'world'])
  })

  it('should throw error when API returns non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    })

    const adapter = new DiscordSourceAdapter(
      'bot-token',
      'channel-123',
      fetchMock,
    )

    await expect(adapter.getChannelMessages(24)).rejects.toThrow(
      'Discord API error: 403 Forbidden',
    )
  })

  it('should paginate when API returns 100 messages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeMessage(String(i + 1), `msg-${i + 1}`),
    )
    const page2 = [makeMessage('200', 'last-msg')]

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 })

    const adapter = new DiscordSourceAdapter(
      'bot-token',
      'channel-123',
      fetchMock,
    )
    const result = await adapter.getChannelMessages(24)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(101)
    expect(result[result.length - 1]).toBe('last-msg')

    const secondCallUrl = fetchMock.mock.calls[1][0] as string
    expect(secondCallUrl).toContain('after=100')
  })
})
