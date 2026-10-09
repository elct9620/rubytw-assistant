import { http, HttpResponse } from 'msw'
import { container } from '../../src/container'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DiscordSourceAdapter,
  formatMessageToXml,
} from '../../src/adapters/discord-source'
import { TOKENS } from '../../src/tokens'
import { network } from '../msw-server'

const DISCORD_EPOCH = 1420070400000n
const MESSAGES_URL = 'https://discord.com/api/v10/channels/channel-123/messages'

const SELF_ID = 'assistant-1'
const REPLY = 19

const newAdapter = () =>
  new DiscordSourceAdapter('bot-token', 'channel-123', SELF_ID, 'guild-1')

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
    type?: number
    message_reference?: { type?: number; message_id?: string }
    referenced_message?: {
      id: string
      content: string
      author: { id: string; global_name: string | null; username: string }
    } | null
    message_snapshots?: {
      message: {
        content: string
        attachments: { filename: string; url: string }[]
      }
    }[]
  },
) {
  return {
    id,
    content,
    type: overrides?.type ?? 0,
    message_reference: overrides?.message_reference,
    referenced_message: overrides?.referenced_message,
    message_snapshots: overrides?.message_snapshots,
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

    const adapter = newAdapter()
    await adapter.readMessages(lastDay())

    expect(capturedUrl?.searchParams.get('after')).toBe(expectedSnowflake)
    expect(capturedUrl?.searchParams.get('limit')).toBe('100')
    expect(capturedAuth).toBe('Bot bot-token')
  })

  it('should return formatted XML messages and leave out those carrying nothing', async () => {
    network.use(
      http.get(MESSAGES_URL, () => {
        return HttpResponse.json([
          makeMessage('3', 'world'),
          makeMessage('2', ''),
          makeMessage('1', 'hello'),
        ])
      }),
    )

    const adapter = newAdapter()
    const { messages: result } = await adapter.readMessages(lastDay())

    expect(result).toHaveLength(2)
    expect(result[0]).toContain('<item id="1">')
    expect(result[0]).toContain('<content>hello</content>')
    expect(result[1]).toContain('<item id="3">')
    expect(result[1]).toContain('<content>world</content>')
  })

  it('should keep a message that only carries an attachment', async () => {
    network.use(
      http.get(MESSAGES_URL, () =>
        HttpResponse.json([
          makeMessage('1', '', {
            attachments: [{ filename: 'venue.png', url: 'https://cdn/v.png' }],
          }),
        ]),
      ),
    )

    const { messages } = await newAdapter().readMessages(lastDay())

    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('venue.png - https://cdn/v.png')
  })

  it('should keep a forward and hand over the forwarded text and files', async () => {
    network.use(
      http.get(MESSAGES_URL, () =>
        HttpResponse.json([
          makeMessage('1', '', {
            message_reference: { type: 1, message_id: '9' },
            message_snapshots: [
              {
                message: {
                  content: '10/27 RubyJam 報名開始',
                  attachments: [
                    { filename: 'poster.png', url: 'https://cdn/p.png' },
                  ],
                },
              },
            ],
          }),
        ]),
      ),
    )

    const { messages } = await newAdapter().readMessages(lastDay())

    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain(
      '<forwarded>\n<content>10/27 RubyJam 報名開始</content>\n<attachments size="1">\nposter.png - https://cdn/p.png\n</attachments>\n</forwarded>',
    )
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

    const adapter = newAdapter()

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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const adapter = newAdapter()
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

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain('<item id="42">')
    expect(xml).toContain('<user id="u1" bot="false">Alice</user>')
    expect(xml).toContain('<timestamp>2026-03-28T12:00:00.000Z</timestamp>')
    expect(xml).toContain('<content>Hello world</content>')
    expect(xml).toContain('</item>')
  })

  it('should mark bot users', () => {
    const msg = makeMessage('1', 'summary', {
      author: { id: 'bot-1', global_name: 'Bot', username: 'bot', bot: true },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain('<user id="bot-1" bot="true">Bot</user>')
  })

  it('should fall back to username when global_name is null', () => {
    const msg = makeMessage('1', 'hi', {
      author: { id: 'u1', global_name: null, username: 'fallback_user' },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain('>fallback_user</user>')
  })

  it('should include attachments with size', () => {
    const msg = makeMessage('1', 'check this', {
      attachments: [
        { filename: 'image.png', url: 'https://cdn.example.com/image.png' },
        { filename: 'doc.pdf', url: 'https://cdn.example.com/doc.pdf' },
      ],
    })

    const xml = formatMessageToXml(msg, SELF_ID)

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

    const xml = formatMessageToXml(msg, SELF_ID)

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

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain(
      '<content>use &lt;script&gt; &amp; &quot;quotes&quot;</content>',
    )
    expect(xml).toContain('>Tom &amp; &quot;Jerry&quot;</user>')
  })

  it('should omit attachments section when empty', () => {
    const msg = makeMessage('1', 'hello', { attachments: [] })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).not.toContain('<attachments')
  })

  it('should omit mentions section when empty', () => {
    const msg = makeMessage('1', 'hello', { mentions: [] })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).not.toContain('<mentions')
  })

  it('should mark a message the assistant sent', () => {
    const msg = makeMessage('1', 'summary', {
      author: { id: SELF_ID, global_name: 'Assistant', bot: true },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain(
      `<user id="${SELF_ID}" bot="true" self="true">Assistant</user>`,
    )
  })

  it('should not mark another bot as the assistant', () => {
    const msg = makeMessage('1', 'beep', {
      author: { id: 'other-bot', global_name: 'Other', bot: true },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).not.toContain('self=')
  })

  it('should mark a mention of the assistant', () => {
    const msg = makeMessage('1', 'hey', {
      mentions: [
        { id: SELF_ID, global_name: 'Assistant', username: 'assistant' },
        { id: 'u2', global_name: 'Bob', username: 'bob' },
      ],
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain(`<user id="${SELF_ID}" self="true">Assistant</user>`)
    expect(xml).toContain('<user id="u2">Bob</user>')
  })

  it('should name who a reply answers and quote what they wrote', () => {
    const msg = makeMessage('2', 'done already', {
      type: REPLY,
      message_reference: { message_id: '1' },
      referenced_message: {
        id: '1',
        content: 'who books the venue?',
        author: { id: 'u2', global_name: 'Bob', username: 'bob' },
      },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain(
      '<reply-to id="1">\n<user>Bob</user>\n<content>who books the venue?</content>\n</reply-to>',
    )
  })

  it('should cut the replied-to text to its first 200 characters', () => {
    const msg = makeMessage('2', 'noted', {
      type: REPLY,
      message_reference: { message_id: '1' },
      referenced_message: {
        id: '1',
        content: '停'.repeat(250),
        author: { id: 'u2', global_name: 'Bob', username: 'bob' },
      },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain(`<content>${'停'.repeat(200)}</content>`)
    expect(xml).not.toContain('停'.repeat(201))
  })

  it('should mark a reply to the assistant', () => {
    const msg = makeMessage('2', 'that item is done', {
      type: REPLY,
      message_reference: { message_id: '1' },
      referenced_message: {
        id: '1',
        content: '- [停滯] 追問場地',
        author: { id: SELF_ID, global_name: 'Assistant', username: 'a' },
      },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain(
      '<reply-to id="1" self="true">\n<user>Assistant</user>\n<content>- [停滯] 追問場地</content>\n</reply-to>',
    )
  })

  it('should carry only the id when the replied-to message is gone', () => {
    const msg = makeMessage('2', 'agreed', {
      type: REPLY,
      message_reference: { message_id: '1' },
      referenced_message: null,
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).toContain('<reply-to id="1"/>')
  })

  it('should not treat a non-reply reference as a reply', () => {
    const msg = makeMessage('2', 'pinned a message', {
      type: 6,
      message_reference: { message_id: '1' },
    })

    const xml = formatMessageToXml(msg, SELF_ID)

    expect(xml).not.toContain('<reply-to')
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
    child.register(TOKENS.DiscordClientId, { useValue: 'user-1' })
    child.register(TOKENS.DiscordGuildId, { useValue: 'guild-1' })
    const adapter = child.resolve(DiscordSourceAdapter)

    const { messages: result } = await adapter.readMessages(lastDay())

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('<content>hello from DI</content>')
    expect(result[0]).toContain('self="true"')
  })
})

describe('DiscordSourceAdapter.searchMessages', () => {
  const SEARCH_URL =
    'https://discord.com/api/v10/guilds/guild-1/messages/search'

  /** Discord wraps each hit in its own array. */
  const hits = (messages: ReturnType<typeof makeMessage>[], total: number) =>
    HttpResponse.json({
      total_results: total,
      messages: messages.map((m) => [m]),
    })

  function captureSearch(total = 0) {
    const captured: { params?: URLSearchParams } = {}
    network.use(
      http.get(SEARCH_URL, ({ request }) => {
        captured.params = new URL(request.url).searchParams
        return hits([], total)
      }),
    )
    return captured
  }

  it('should search only the configured channel, newest first, a page of 25', async () => {
    const captured = captureSearch()

    await newAdapter().searchMessages({})

    expect(Object.fromEntries(captured.params ?? [])).toEqual({
      channel_id: 'channel-123',
      limit: '25',
      sort_by: 'timestamp',
      sort_order: 'desc',
    })
  })

  it('should keep a hit that only carries an attachment', async () => {
    network.use(
      http.get(SEARCH_URL, () =>
        hits(
          [
            makeMessage('1', '', {
              attachments: [{ filename: 'a.png', url: 'https://cdn/a.png' }],
            }),
            makeMessage('2', ''),
          ],
          2,
        ),
      ),
    )

    const { messages } = await newAdapter().searchMessages({ query: 'x' })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('a.png - https://cdn/a.png')
  })

  it('should return the hits in the message format with the total', async () => {
    network.use(
      http.get(SEARCH_URL, () =>
        hits([makeMessage('9', 'newer'), makeMessage('8', 'older')], 2),
      ),
    )

    const page = await newAdapter().searchMessages({ query: 'anything' })

    expect(page.messages.map(idOf)).toEqual(['9', '8'])
    expect(page.messages[0]).toContain('<content>newer</content>')
    expect(page.total).toBe(2)
    expect(page.nextCursor).toBeNull()
  })

  it('should turn each condition into the matching Discord filter', async () => {
    const captured = captureSearch()
    const since = new Date('2026-03-01T00:00:00Z')
    const until = new Date('2026-03-02T00:00:00Z')

    await newAdapter().searchMessages({
      query: 'meetup venue',
      author: 'member-7',
      involvesSelf: 'mention',
      since,
      until,
      cursor: '50',
    })

    expect(captured.params?.get('content')).toBe('meetup venue')
    expect(captured.params?.get('author_id')).toBe('member-7')
    expect(captured.params?.get('mentions')).toBe(SELF_ID)
    expect(captured.params?.get('min_id')).toBe(String(snowflakeAt(since)))
    expect(captured.params?.get('max_id')).toBe(String(snowflakeAt(until) - 1n))
    expect(captured.params?.get('offset')).toBe('50')
  })

  it('should resolve self as the author to the assistant', async () => {
    const captured = captureSearch()

    await newAdapter().searchMessages({ author: 'self' })

    expect(captured.params?.get('author_id')).toBe(SELF_ID)
  })

  it('should search only what people wrote when the author is people', async () => {
    const captured = captureSearch()

    await newAdapter().searchMessages({ author: 'people' })

    expect(captured.params?.get('author_type')).toBe('user')
    expect(captured.params?.has('author_id')).toBe(false)
  })

  it('should search replies to the assistant by who was replied to', async () => {
    const captured = captureSearch()

    await newAdapter().searchMessages({ involvesSelf: 'reply' })

    expect(captured.params?.get('replied_to_user_id')).toBe(SELF_ID)
    expect(captured.params?.has('mentions')).toBe(false)
  })

  it('should hand back the next offset while matches remain', async () => {
    network.use(
      http.get(SEARCH_URL, () =>
        hits(
          Array.from({ length: 25 }, (_, i) =>
            makeMessage(String(100 - i), 'm'),
          ),
          60,
        ),
      ),
    )

    const first = await newAdapter().searchMessages({})
    const last = await newAdapter().searchMessages({ cursor: '50' })

    expect(first.nextCursor).toBe('25')
    expect(last.nextCursor).toBeNull()
  })

  it('should retry while the search index is not ready', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let requestCount = 0
    network.use(
      http.get(SEARCH_URL, () => {
        requestCount++
        return requestCount === 1
          ? HttpResponse.json(
              {
                code: 110000,
                message: 'Index not yet available',
                retry_after: 0,
              },
              { status: 202 },
            )
          : hits([makeMessage('1', 'found')], 1)
      }),
    )

    const page = await newAdapter().searchMessages({})

    expect(requestCount).toBe(2)
    expect(page.messages).toHaveLength(1)
    warnSpy.mockRestore()
  })

  it('should fail once the index stays unavailable through every retry', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    network.use(
      http.get(SEARCH_URL, () =>
        HttpResponse.json({ code: 110000, retry_after: 0 }, { status: 202 }),
      ),
    )

    await expect(newAdapter().searchMessages({})).rejects.toThrow(
      /index is not ready/,
    )
    warnSpy.mockRestore()
  })
})

describe('DiscordSourceAdapter.readMessage', () => {
  const MESSAGE_URL = `${MESSAGES_URL}/:id`

  it('should read one message of the configured channel by id', async () => {
    let requestedId: string | undefined
    network.use(
      http.get(MESSAGE_URL, ({ params }) => {
        requestedId = String(params.id)
        return HttpResponse.json(
          makeMessage('42', '我來問場地', {
            timestamp: '2026-10-08T14:40:41.343000+00:00',
          }),
        )
      }),
    )

    const message = await newAdapter().readMessage('42')

    expect(requestedId).toBe('42')
    expect(message).toEqual({
      id: '42',
      text: '我來問場地',
      timestamp: '2026-10-08T14:40:41.343000+00:00',
      fromSelf: false,
    })
  })

  it('should mark a message the assistant wrote', async () => {
    network.use(
      http.get(MESSAGE_URL, () =>
        HttpResponse.json(
          makeMessage('42', 'list', { author: { id: SELF_ID } }),
        ),
      ),
    )

    const message = await newAdapter().readMessage('42')

    expect(message?.fromSelf).toBe(true)
  })

  it('should include the forwarded text in what a quote is matched against', async () => {
    network.use(
      http.get(MESSAGE_URL, () =>
        HttpResponse.json(
          makeMessage('42', '', {
            message_reference: { type: 1, message_id: '9' },
            message_snapshots: [
              { message: { content: '報名開始', attachments: [] } },
            ],
          }),
        ),
      ),
    )

    const message = await newAdapter().readMessage('42')

    expect(message?.text).toContain('報名開始')
  })

  it('should answer null without retrying when the channel has no such message', async () => {
    let calls = 0
    network.use(
      http.get(MESSAGE_URL, () => {
        calls++
        return HttpResponse.json(
          { code: 10008, message: 'Unknown Message' },
          { status: 404 },
        )
      }),
    )

    const message = await newAdapter().readMessage('42')

    expect(message).toBeNull()
    expect(calls).toBe(1)
  })

  it('should fail when Discord refuses the read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    network.use(
      http.get(MESSAGE_URL, () =>
        HttpResponse.json({ message: 'Missing Access' }, { status: 403 }),
      ),
    )

    await expect(newAdapter().readMessage('42')).rejects.toThrow(/403/)
  })
})
