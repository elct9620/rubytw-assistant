import { http, HttpResponse } from 'msw'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DiscordSourceAdapter,
  formatMessageToXml,
} from '../../src/adapters/discord-source'
import { server } from '../msw-server'

const DISCORD_EPOCH = 1420070400000n
const MESSAGES_URL = 'https://discord.com/api/v10/channels/channel-123/messages'

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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should request messages from correct API endpoint with after snowflake', async () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const expectedSnowflake = String(
      (BigInt(now - 24 * 3600 * 1000) - DISCORD_EPOCH) << 22n,
    )

    let capturedUrl: URL | undefined
    let capturedAuth: string | undefined

    server.use(
      http.get(MESSAGES_URL, ({ request }) => {
        capturedUrl = new URL(request.url)
        capturedAuth = request.headers.get('Authorization') ?? undefined
        return HttpResponse.json([])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    await adapter.getChannelMessages(24)

    expect(capturedUrl?.searchParams.get('after')).toBe(expectedSnowflake)
    expect(capturedUrl?.searchParams.get('limit')).toBe('100')
    expect(capturedAuth).toBe('Bot bot-token')
  })

  it('should return formatted XML messages and filter out empty content', async () => {
    server.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json([
          makeMessage('1', 'hello'),
          makeMessage('2', ''),
          makeMessage('3', 'world'),
        ])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const result = await adapter.getChannelMessages(24)

    expect(result).toHaveLength(2)
    expect(result[0]).toContain('<item id="1">')
    expect(result[0]).toContain('<content>hello</content>')
    expect(result[1]).toContain('<item id="3">')
    expect(result[1]).toContain('<content>world</content>')
  })

  it('should throw error when API returns non-ok response', async () => {
    server.use(
      http.get(MESSAGES_URL, () => {
        return new HttpResponse(null, {
          status: 403,
          statusText: 'Forbidden',
        })
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')

    await expect(adapter.getChannelMessages(24)).rejects.toThrow(
      'Discord API error: 403 Forbidden',
    )
  })

  it('should paginate when API returns 100 messages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeMessage(String(i + 1), `msg-${i + 1}`),
    )
    const page2 = [makeMessage('200', 'last-msg')]

    let requestCount = 0
    let secondRequestAfter: string | null = null

    server.use(
      http.get(MESSAGES_URL, ({ request }) => {
        requestCount++
        const url = new URL(request.url)
        if (requestCount === 1) {
          return HttpResponse.json(page1)
        }
        secondRequestAfter = url.searchParams.get('after')
        return HttpResponse.json(page2)
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const result = await adapter.getChannelMessages(24)

    expect(requestCount).toBe(2)
    expect(result).toHaveLength(101)
    expect(result[result.length - 1]).toContain('<content>last-msg</content>')
    expect(secondRequestAfter).toBe('100')
  })

  it('should stop paginating after reaching max pages', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      makeMessage(String(i + 1), `msg-${i + 1}`),
    )

    let requestCount = 0

    server.use(
      http.get(MESSAGES_URL, () => {
        requestCount++
        return HttpResponse.json(fullPage)
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const result = await adapter.getChannelMessages(24)

    expect(requestCount).toBe(5)
    expect(result).toHaveLength(500)
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

  it('should escape XML special characters in content and author name', () => {
    const msg = makeMessage('1', 'use <script> & "quotes"', {
      author: {
        id: 'u1',
        global_name: 'Tom & "Jerry"',
        username: 'tom',
      },
    })

    const xml = formatMessageToXml(msg)

    expect(xml).toContain(
      '<content>use &lt;script&gt; &amp; &quot;quotes&quot;</content>',
    )
    expect(xml).toContain('>Tom &amp; &quot;Jerry&quot;</user>')
  })

  it('should omit attachments section when empty', () => {
    const msg = makeMessage('1', 'hello', { attachments: [] })

    const xml = formatMessageToXml(msg)

    expect(xml).not.toContain('<attachments')
  })

  it('should omit mentions section when empty', () => {
    const msg = makeMessage('1', 'hello', { mentions: [] })

    const xml = formatMessageToXml(msg)

    expect(xml).not.toContain('<mentions')
  })
})
