import { injectable, inject } from 'tsyringe'
import type {
  DiscordSource,
  MessagePage,
  MessageSearchPage,
  ReadMessagesQuery,
  SearchMessagesQuery,
} from '../usecases/ports'
import { assertDiscordResponse, escapeXml } from './shared'
import { DiscordRateLimiter } from './discord-rate-limit'
import { withRetry } from '../services/retry'
import { TOKENS } from '../tokens'

const DISCORD_EPOCH = 1420070400000n
const DISCORD_API = 'https://discord.com/api/v10'
const MAX_MESSAGES_PER_REQUEST = 100

// https://docs.discord.com/developers/resources/message#search-guild-messages
const SEARCH_PAGE_SIZE = 25
const SEARCH_MAX_OFFSET = 9975
const SEARCH_INDEX_NOT_READY = 202
const SELF_FILTERS = {
  mention: 'mentions',
  reply: 'replied_to_user_id',
} as const

/** The smallest message id Discord could have issued at that instant. */
function snowflakeAt(time: Date): bigint {
  return (BigInt(time.getTime()) - DISCORD_EPOCH) << 22n
}

// https://docs.discord.com/developers/resources/message#message-object-message-types
const REPLY_MESSAGE_TYPE = 19
// https://docs.discord.com/developers/resources/message#message-reference-types
const FORWARD_REFERENCE_TYPE = 1
const REPLIED_TEXT_LIMIT = 200

interface DiscordUser {
  id: string
  global_name: string | null
  username: string
  bot?: boolean
}

interface DiscordAttachment {
  filename: string
  url: string
}

interface DiscordMessage {
  id: string
  type: number
  content: string
  author: DiscordUser
  timestamp: string
  attachments: DiscordAttachment[]
  mentions: DiscordUser[]
  message_reference?: { type?: number; message_id?: string }
  /** Null once the replied-to message has been deleted. */
  referenced_message?: {
    id: string
    content: string
    author: DiscordUser
  } | null
  /** A forward carries the forwarded message here, without its author. */
  message_snapshots?: {
    message: { content: string; attachments: DiscordAttachment[] }
  }[]
}

/** Each hit arrives wrapped in its own array. */
interface DiscordSearchResult {
  total_results: number
  messages: DiscordMessage[][]
}

const displayName = (user: DiscordUser) =>
  escapeXml(user.global_name ?? user.username)

const forwardedOf = (msg: DiscordMessage) =>
  msg.message_reference?.type === FORWARD_REFERENCE_TYPE
    ? msg.message_snapshots?.[0]?.message
    : undefined

/** Whether the message carries anything to read: text, files, or a forward. */
const hasSubstance = (msg: DiscordMessage) =>
  msg.content !== '' || msg.attachments.length > 0 || !!forwardedOf(msg)

function attachmentsXml(attachments: DiscordAttachment[]): string[] {
  if (attachments.length === 0) return []
  return [
    `<attachments size="${attachments.length}">`,
    attachments.map((a) => `${escapeXml(a.filename)} - ${a.url}`).join('\n'),
    '</attachments>',
  ]
}

export function formatMessageToXml(
  msg: DiscordMessage,
  selfId: string,
): string {
  const selfMark = (user: DiscordUser) =>
    user.id === selfId ? ' self="true"' : ''
  const isBot = msg.author.bot ?? false

  const parts = [
    `<item id="${msg.id}">`,
    `<user id="${msg.author.id}" bot="${isBot}"${selfMark(msg.author)}>${displayName(msg.author)}</user>`,
    `<timestamp>${msg.timestamp}</timestamp>`,
  ]

  const repliedToId = msg.message_reference?.message_id
  if (msg.type === REPLY_MESSAGE_TYPE && repliedToId) {
    const target = msg.referenced_message
    parts.push(
      target
        ? [
            `<reply-to id="${target.id}"${selfMark(target.author)}>`,
            `<user>${displayName(target.author)}</user>`,
            `<content>${escapeXml([...target.content].slice(0, REPLIED_TEXT_LIMIT).join(''))}</content>`,
            '</reply-to>',
          ].join('\n')
        : `<reply-to id="${repliedToId}"/>`,
    )
  }

  parts.push(`<content>${escapeXml(msg.content)}</content>`)
  parts.push(...attachmentsXml(msg.attachments))

  const forwarded = forwardedOf(msg)
  if (forwarded) {
    parts.push(
      '<forwarded>',
      `<content>${escapeXml(forwarded.content)}</content>`,
      ...attachmentsXml(forwarded.attachments),
      '</forwarded>',
    )
  }

  if (msg.mentions.length > 0) {
    const mentionLines = msg.mentions
      .map((m) => `<user id="${m.id}"${selfMark(m)}>${displayName(m)}</user>`)
      .join('\n')
    parts.push('<mentions>')
    parts.push(mentionLines)
    parts.push('</mentions>')
  }

  parts.push('</item>')
  return parts.join('\n')
}

@injectable()
export class DiscordSourceAdapter implements DiscordSource {
  constructor(
    @inject(TOKENS.DiscordBotToken) private botToken: string,
    @inject(TOKENS.DiscordChannelId) private channelId: string,
    // The bot's user id is its application's client id.
    @inject(TOKENS.DiscordClientId) private selfId: string,
    @inject(TOKENS.DiscordGuildId) private guildId: string,
    @inject(TOKENS.DiscordRateLimiter)
    private rateLimiter: DiscordRateLimiter = new DiscordRateLimiter(),
  ) {}

  async readMessages({
    since,
    until,
    limit,
    cursor,
  }: ReadMessagesQuery): Promise<MessagePage> {
    const end = until ? snowflakeAt(until) : null
    let after = cursor ?? String(snowflakeAt(since))
    let exhausted = false
    let fetched = 0
    const collected: DiscordMessage[] = []

    while (!exhausted && fetched < limit) {
      const pageSize = Math.min(MAX_MESSAGES_PER_REQUEST, limit - fetched)
      const batch = await this.fetchMessages(after, pageSize)
      const inRange = end ? batch.filter((msg) => BigInt(msg.id) < end) : batch
      fetched += inRange.length
      collected.push(...inRange.filter(hasSubstance))

      exhausted = batch.length < pageSize || inRange.length < batch.length
      if (!exhausted) after = batch[batch.length - 1].id
    }

    if (fetched > 0 && collected.length === 0) {
      console.warn(
        `Discord returned ${fetched} messages but none had content. ` +
          'Ensure the MESSAGE_CONTENT privileged intent is enabled in the Discord Developer Portal.',
      )
    }

    return {
      messages: collected.map((msg) => formatMessageToXml(msg, this.selfId)),
      nextCursor: exhausted ? null : after,
    }
  }

  async searchMessages({
    query,
    author,
    involvesSelf,
    since,
    until,
    cursor,
  }: SearchMessagesQuery): Promise<MessageSearchPage> {
    const offset = Number(cursor ?? 0)
    const params = new URLSearchParams({
      channel_id: this.channelId,
      limit: String(SEARCH_PAGE_SIZE),
      sort_by: 'timestamp',
      sort_order: 'desc',
    })
    if (query) params.set('content', query)
    if (author === 'people') {
      params.set('author_type', 'user')
    } else if (author) {
      params.set('author_id', author === 'self' ? this.selfId : author)
    }
    if (involvesSelf) {
      params.set(SELF_FILTERS[involvesSelf], this.selfId)
    }
    if (since) params.set('min_id', String(snowflakeAt(since)))
    if (until) params.set('max_id', String(snowflakeAt(until) - 1n))
    if (offset > 0) params.set('offset', String(offset))

    const result = await this.request(
      'searchMessages',
      `${DISCORD_API}/guilds/${this.guildId}/messages/search?${params}`,
      async (response) => {
        if (response.status === SEARCH_INDEX_NOT_READY) {
          throw new Error('Discord search index is not ready')
        }
        return (await response.json()) as DiscordSearchResult
      },
    )

    const next = offset + SEARCH_PAGE_SIZE
    return {
      messages: result.messages
        .flat()
        .filter(hasSubstance)
        .map((msg) => formatMessageToXml(msg, this.selfId)),
      total: result.total_results,
      nextCursor:
        next < result.total_results && next <= SEARCH_MAX_OFFSET
          ? String(next)
          : null,
    }
  }

  private fetchMessages(
    after: string,
    limit: number,
  ): Promise<DiscordMessage[]> {
    return this.request(
      'fetchMessages',
      `${DISCORD_API}/channels/${this.channelId}/messages?after=${after}&limit=${limit}`,
      // Discord answers newest first, even when paging forward with `after`.
      async (response) =>
        ((await response.json()) as DiscordMessage[]).reverse(),
    )
  }

  private request<T>(
    label: string,
    url: string,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    return withRetry(
      async () => {
        const response = await this.rateLimiter.fetch(label, url, {
          headers: { Authorization: `Bot ${this.botToken}` },
        })
        await assertDiscordResponse(response)
        return read(response)
      },
      {
        onRetry: (error, attempt) => {
          console.warn(
            `Discord ${label} retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )
  }
}
