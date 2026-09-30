import { http, HttpResponse } from 'msw'
import { container } from 'tsyringe'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DiscordSourceAdapter,
  formatMessageToXml,
} from '../../src/adapters/discord-source'
import { TOKENS } from '../../src/tokens'
import { network } from '../msw-server'

const DISCORD_EPOCH = 1420070400000n
const MESSAGES_URL = 'https://discord.com/api/v10/channels/channel-123/messages'

const lastDay = () => ({
  since: new Date(Date.now() - 24 * 3600 * 1000),
  limit: 500,
})

const snowflakeAt = (time: Date) =>
  (BigInt(time.getTime()) - DISCORD_EPOCH) << 22n

const idOf = (xml: string) => /<item id="(\d+)">/.exec(xml)?.[1]

/** A full page of the messages right after `after`, newest first as Discord answers. */
function pageFollowing(request: Request) {
  const params = new URL(request.url).searchParams
  const after = BigInt(params.get('after') ?? '0')
  const size = Number(params.get('limit'))
  return Array.from({ length: size }, (_, i) =>
    makeMessage(String(after + BigInt(size - i)), 'message'),
  )
}

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

    network.use(
      http.get(MESSAGES_URL, ({ request }) => {
        capturedUrl = new URL(request.url)
        capturedAuth = request.headers.get('Authorization') ?? undefined
        return HttpResponse.json([])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    await adapter.readMessages(lastDay())

    expect(capturedUrl?.searchParams.get('after')).toBe(expectedSnowflake)
    expect(capturedUrl?.searchParams.get('limit')).toBe('100')
    expect(capturedAuth).toBe('Bot bot-token')
  })

  it('should return formatted XML messages and filter out empty content', async () => {
    network.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json([
          makeMessage('3', 'world'),
          makeMessage('2', ''),
          makeMessage('1', 'hello'),
        ])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const { messages: result } = await adapter.readMessages(lastDay())

    expect(result).toHaveLength(2)
    expect(result[0]).toContain('<item id="1">')
    expect(result[0]).toContain('<content>hello</content>')
    expect(result[1]).toContain('<item id="3">')
    expect(result[1]).toContain('<content>world</content>')
  })

  it('should throw error with response body when API returns non-ok response', async () => {
    network.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json(
          { code: 50001, message: 'Missing Access' },
          { status: 403, statusText: 'Forbidden' },
        )
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')

    await expect(adapter.readMessages(lastDay())).rejects.toThrow(
      /Discord API error: 403 Forbidden.*Missing Access/,
    )
  })

  it('should warn when messages are returned but all have empty content', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    network.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json([makeMessage('1', ''), makeMessage('2', '')])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const { messages: result } = await adapter.readMessages(lastDay())

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('MESSAGE_CONTENT'),
    )

    warnSpy.mockRestore()
  })

  it('should return messages oldest first when Discord answers newest first', async () => {
    network.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json([
          makeMessage('3', 'third'),
          makeMessage('2', 'second'),
          makeMessage('1', 'first'),
        ])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const { messages: result } = await adapter.readMessages(lastDay())

    expect(result.map((xml) => /<item id="(\d+)">/.exec(xml)?.[1])).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('should continue after the newest message when a page is full', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeMessage(String(100 - i), `msg-${100 - i}`),
    )
    const page2 = [makeMessage('200', 'last-msg')]

    let requestCount = 0
    let secondRequestAfter: string | null = null

    network.use(
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
    const { messages: result } = await adapter.readMessages(lastDay())

    expect(requestCount).toBe(2)
    expect(result).toHaveLength(101)
    expect(result[result.length - 1]).toContain('<content>last-msg</content>')
    expect(secondRequestAfter).toBe('100')
  })

  it('should stop at the limit and hand back a cursor when more remain', async () => {
    let requestCount = 0
    network.use(
      http.get(MESSAGES_URL, ({ request }) => {
        requestCount++
        return HttpResponse.json(pageFollowing(request))
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const page = await adapter.readMessages(lastDay())

    expect(requestCount).toBe(5)
    expect(page.messages).toHaveLength(500)
    expect(page.nextCursor).toBe(idOf(page.messages[499]))
  })

  it('should ask Discord for no more than the limit', async () => {
    let requestedLimit: string | null = null
    network.use(
      http.get(MESSAGES_URL, ({ request }) => {
        requestedLimit = new URL(request.url).searchParams.get('limit')
        return HttpResponse.json(pageFollowing(request))
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const page = await adapter.readMessages({ ...lastDay(), limit: 50 })

    expect(requestedLimit).toBe('50')
    expect(page.messages).toHaveLength(50)
  })

  it('should report no cursor once the range is exhausted', async () => {
    network.use(
      http.get(MESSAGES_URL, () =>
        HttpResponse.json([makeMessage('2', 'b'), makeMessage('1', 'a')]),
      ),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const page = await adapter.readMessages(lastDay())

    expect(page.nextCursor).toBeNull()
  })

  it('should continue from a cursor instead of the start of the range', async () => {
    let after: string | null = null
    network.use(
      http.get(MESSAGES_URL, ({ request }) => {
        after = new URL(request.url).searchParams.get('after')
        return HttpResponse.json([])
      }),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    await adapter.readMessages({ ...lastDay(), cursor: '4242' })

    expect(after).toBe('4242')
  })

  it('should leave out messages sent at or after until', async () => {
    const until = new Date('2026-03-28T12:00:00Z')
    const before = snowflakeAt(new Date('2026-03-28T11:59:59Z'))
    const atUntil = snowflakeAt(until)
    network.use(
      http.get(MESSAGES_URL, () =>
        HttpResponse.json([
          makeMessage(String(atUntil), 'too late'),
          makeMessage(String(before), 'in range'),
        ]),
      ),
    )

    const adapter = new DiscordSourceAdapter('bot-token', 'channel-123')
    const page = await adapter.readMessages({
      since: new Date('2026-03-28T00:00:00Z'),
      until,
      limit: 2,
    })

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0]).toContain('<content>in range</content>')
    expect(page.nextCursor).toBeNull()
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

describe('DiscordSourceAdapter DI integration', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should resolve from container and fetch messages via Discord API', async () => {
    network.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json([makeMessage('1', 'hello from DI')])
      }),
    )

    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'di-test-token' })
    child.register(TOKENS.DiscordChannelId, { useValue: 'channel-123' })
    const adapter = child.resolve(DiscordSourceAdapter)

    const { messages: result } = await adapter.readMessages(lastDay())

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('<content>hello from DI</content>')
  })
})
