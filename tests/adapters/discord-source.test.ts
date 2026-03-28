import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DiscordSourceAdapter,
  formatMessageToXml,
} from '../../src/adapters/discord-source'

const DISCORD_EPOCH = 1420070400000n

function makeMessage(
  id: string,
  content: string,
  overrides?: {
    author?: {
      id?: string
      global_name?: string | null
      username?: string
      bot?: boolean
    }
    timestamp?: string
    attachments?: { filename: string; url: string }[]
    mentions?: { id: string; global_name: string | null; username: string }[]
  },
) {
  return {
    id,
    content,
    author: {
      id: 'user-1',
      global_name: 'Test User',
      username: 'testuser',
      bot: false,
      ...overrides?.author,
    },
    timestamp: overrides?.timestamp ?? '2026-03-28T00:00:00.000Z',
    attachments: overrides?.attachments ?? [],
    mentions: overrides?.mentions ?? [],
  }
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

  it('should return formatted XML messages and filter out empty content', async () => {
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

    expect(result).toHaveLength(2)
    expect(result[0]).toContain('<item id="1">')
    expect(result[0]).toContain('<content>hello</content>')
    expect(result[1]).toContain('<item id="3">')
    expect(result[1]).toContain('<content>world</content>')
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
    expect(result[result.length - 1]).toContain('<content>last-msg</content>')

    const secondCallUrl = fetchMock.mock.calls[1][0] as string
    expect(secondCallUrl).toContain('after=100')
  })
})

describe('formatMessageToXml', () => {
  it('should format message with author, timestamp, and content', () => {
    const msg = makeMessage('42', 'Hello world', {
      author: { id: 'u1', global_name: 'Alice', username: 'alice', bot: false },
      timestamp: '2026-03-28T12:00:00.000Z',
    })

    const xml = formatMessageToXml(msg)

    expect(xml).toContain('<item id="42">')
    expect(xml).toContain('<user bot="false">Alice</user>')
    expect(xml).toContain('<timestamp>2026-03-28T12:00:00.000Z</timestamp>')
    expect(xml).toContain('<content>Hello world</content>')
    expect(xml).toContain('</item>')
  })

  it('should mark bot users', () => {
    const msg = makeMessage('1', 'summary', {
      author: { id: 'bot-1', global_name: 'Bot', username: 'bot', bot: true },
    })

    const xml = formatMessageToXml(msg)

    expect(xml).toContain('<user bot="true">Bot</user>')
  })

  it('should fall back to username when global_name is null', () => {
    const msg = makeMessage('1', 'hi', {
      author: { id: 'u1', global_name: null, username: 'fallback_user' },
    })

    const xml = formatMessageToXml(msg)

    expect(xml).toContain('>fallback_user</user>')
  })

  it('should include attachments with size', () => {
    const msg = makeMessage('1', 'check this', {
      attachments: [
        { filename: 'image.png', url: 'https://cdn.example.com/image.png' },
        { filename: 'doc.pdf', url: 'https://cdn.example.com/doc.pdf' },
      ],
    })

    const xml = formatMessageToXml(msg)

    expect(xml).toContain('<attachments size="2">')
    expect(xml).toContain('image.png - https://cdn.example.com/image.png')
    expect(xml).toContain('doc.pdf - https://cdn.example.com/doc.pdf')
  })

  it('should include mentions', () => {
    const msg = makeMessage('1', 'hey <@u2>', {
      mentions: [
        { id: 'u2', global_name: 'Bob', username: 'bob' },
        { id: 'u3', global_name: null, username: 'charlie' },
      ],
    })

    const xml = formatMessageToXml(msg)

    expect(xml).toContain('<user id="u2">Bob</user>')
    expect(xml).toContain('<user id="u3">charlie</user>')
  })
})
