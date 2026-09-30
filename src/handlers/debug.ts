import { Hono } from 'hono'
import { container } from '../container'
import { TOKENS } from '../tokens'
import { GenerateSummary } from '../usecases/generate-summary'
import type { DiscordSource, GitHubSource } from '../usecases/ports'
import { runWithTrace, setupTrace } from './telemetry-setup'
import { classifySummaryResult, summarizeResult } from './summarize-result'

const debug = new Hono<{ Bindings: Env }>()

// Defence in depth: debug endpoints are developer-only. Even when
// DEBUG_MODE is accidentally enabled in production, reject requests that
// do not originate from localhost (wrangler dev serves on localhost).
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

debug.use('*', async (c, next) => {
  const { hostname } = new URL(c.req.url)
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    return c.notFound()
  }
  return next()
})

debug.get('/summary', async (c) => {
  const channelId = c.req.query('channel_id')
  if (!channelId) {
    return c.json({ error: 'channel_id is required' }, 400)
  }

  const child = container.createChildContainer()
  child.register(TOKENS.DiscordChannelId, { useValue: channelId })
  const trace = setupTrace(child)

  const usecase = child.resolve(GenerateSummary)
  const hours = Number(c.req.query('hours')) || Number(c.env.SUMMARY_HOURS)

  try {
    const result = await runWithTrace(trace, {
      spanName: 'generate-summary',
      input: { channelId, hours, debug: true },
      summarizeOutput: summarizeResult,
      classifyResult: classifySummaryResult,
      fn: () => usecase.execute(hours),
    })
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

// Temporary: records how Discord actually behaves so the message tools are
// built on observation. Removed once the tools are verified.
const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_EPOCH = 1420070400000n
const PROBE_DEFAULT_DAYS = 30

interface ProbeMessage {
  id: string
  type: number
  timestamp: string
  author: { id: string; username: string; bot?: boolean }
  mentions?: { id: string }[]
  message_reference?: { message_id?: string }
  referenced_message?: { id: string; author: { id: string } } | null
}

const edge = (msg?: ProbeMessage) =>
  msg ? { id: msg.id, timestamp: msg.timestamp } : null

debug.get('/discord-probe', async (c) => {
  const channelId = c.req.query('channel_id')
  if (!channelId) {
    return c.json({ error: 'channel_id is required' }, 400)
  }

  const sinceParam = c.req.query('since')
  const sinceMs = sinceParam
    ? Date.parse(sinceParam)
    : Date.now() - PROBE_DEFAULT_DAYS * 24 * 3600 * 1000
  if (Number.isNaN(sinceMs)) {
    return c.json({ error: 'since must be an ISO 8601 timestamp' }, 400)
  }
  const sinceSnowflake = String((BigInt(sinceMs) - DISCORD_EPOCH) << 22n)

  const headers = { Authorization: `Bot ${c.env.DISCORD_BOT_TOKEN}` }
  const get = async (path: string) => {
    const response = await fetch(`${DISCORD_API}${path}`, { headers })
    const body = await response.json().catch(() => null)
    return { status: response.status, body }
  }

  const page = async (after: string) => {
    const { status, body } = await get(
      `/channels/${channelId}/messages?after=${after}&limit=100`,
    )
    return { status, messages: Array.isArray(body) ? body : [], body }
  }
  const describePage = (
    result: Awaited<ReturnType<typeof page>>,
    seen: Set<string>,
  ) => {
    const messages = result.messages as ProbeMessage[]
    return {
      status: result.status,
      ...(result.status !== 200 && { body: result.body }),
      count: messages.length,
      first: edge(messages[0]),
      last: edge(messages[messages.length - 1]),
      overlapWithFirstPage: messages.filter((m) => seen.has(m.id)).length,
    }
  }

  const first = await page(sinceSnowflake)
  const firstMessages = first.messages as ProbeMessage[]
  const firstIds = new Set(firstMessages.map((m) => m.id))
  const pagination: Record<string, unknown> = {
    sinceSnowflake,
    page1: describePage(first, new Set()),
  }
  if (firstMessages.length > 0) {
    const head = firstMessages[0].id
    const tail = firstMessages[firstMessages.length - 1].id
    pagination.nextAfterFirstElement = describePage(await page(head), firstIds)
    pagination.nextAfterLastElement = describePage(await page(tail), firstIds)
  }

  const replies = firstMessages.filter((m) => m.type === 19)
  const replyShape = {
    count: replies.length,
    sample: replies[0]
      ? {
          id: replies[0].id,
          messageReferenceId: replies[0].message_reference?.message_id ?? null,
          referencedMessage: replies[0].referenced_message
            ? {
                id: replies[0].referenced_message.id,
                authorId: replies[0].referenced_message.author.id,
              }
            : null,
        }
      : null,
  }

  const me = await get('/users/@me')
  const botAuthors = new Map<string, string>()
  for (const msg of firstMessages) {
    if (msg.author.bot) botAuthors.set(msg.author.id, msg.author.username)
  }
  const clientId = c.env.DISCORD_CLIENT_ID
  const identity = {
    clientId,
    usersMe:
      me.status === 200
        ? {
            id: (me.body as { id: string }).id,
            username: (me.body as { username: string }).username,
          }
        : { status: me.status, body: me.body },
    botAuthorsInChannel: Object.fromEntries(botAuthors),
  }

  const selfId =
    me.status === 200 ? (me.body as { id: string }).id : String(clientId)
  const search = async (label: string, params: Record<string, string>) => {
    const query = new URLSearchParams({
      channel_id: channelId,
      limit: '5',
      ...params,
    })
    const { status, body } = await get(
      `/guilds/${c.env.DISCORD_GUILD_ID}/messages/search?${query}`,
    )
    const result = (body ?? {}) as {
      total_results?: number
      messages?: ProbeMessage[][]
      retry_after?: number
      code?: number
      message?: string
    }
    return {
      label,
      status,
      keys: body && typeof body === 'object' ? Object.keys(body) : [],
      totalResults: result.total_results ?? null,
      retryAfter: result.retry_after ?? null,
      error:
        status >= 400 ? { code: result.code, message: result.message } : null,
      hits: (result.messages ?? []).map((group) =>
        group.map((m) => ({
          id: m.id,
          timestamp: m.timestamp,
          authorId: m.author.id,
        })),
      ),
    }
  }
  const content = c.req.query('q')
  const searches = [
    ...(content ? [await search('content', { content })] : []),
    await search('channel only', {}),
    await search('min_id', { min_id: sinceSnowflake }),
    await search('author_id=self', { author_id: selfId }),
    await search('mentions=self', { mentions: selfId }),
    await search('replied_to_user_id=self', { replied_to_user_id: selfId }),
    await search('sort asc', { sort_by: 'timestamp', sort_order: 'asc' }),
    await search('offset=5', { offset: '5' }),
  ]
  const userId = c.req.query('user_id')
  if (userId) {
    searches.push(
      await search('mentions=user', { mentions: userId }),
      await search('replied_to_user_id=user', { replied_to_user_id: userId }),
      await search('mentions+replied_to_user_id', {
        mentions: userId,
        replied_to_user_id: userId,
      }),
    )
  }

  return c.json({ pagination, replyShape, identity, searches })
})

// Temporary: runs the GitHub and Discord sources against the live APIs.
debug.get('/source-probe', async (c) => {
  const child = container.createChildContainer()
  const channelId = c.req.query('channel_id')
  if (channelId) {
    child.register(TOKENS.DiscordChannelId, { useValue: channelId })
  }
  const attempt = async <T>(run: () => Promise<T>) => {
    try {
      return await run()
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  const github = child.resolve<GitHubSource>(TOKENS.GitHubSource)
  const discord = child.resolve<DiscordSource>(TOKENS.DiscordSource)
  const q = c.req.query('q')
  const numbers = (c.req.query('numbers') ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
  const since = c.req.query('since')
  const until = c.req.query('until')
  const range = {
    since: since ? new Date(since) : undefined,
    until: until ? new Date(until) : undefined,
  }

  return c.json({
    searchIssues: q ? await attempt(() => github.searchIssues(q)) : null,
    readIssues: numbers.length
      ? await attempt(() => github.readIssues(numbers, 200))
      : null,
    readMessages: range.since
      ? await attempt(() =>
          discord.readMessages({
            since: range.since!,
            until: range.until,
            limit: Number(c.req.query('limit') ?? 5),
            cursor: c.req.query('cursor'),
          }),
        )
      : null,
    searchMessages: c.req.query('search')
      ? await attempt(() =>
          discord.searchMessages({
            query: c.req.query('mq') || undefined,
            author: c.req.query('author') || undefined,
            involvesSelf:
              (c.req.query('involves_self') as 'mention' | 'reply') ||
              undefined,
            ...range,
            cursor: c.req.query('cursor'),
          }),
        )
      : null,
  })
})

export default debug
