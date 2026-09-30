import { injectable, inject } from 'tsyringe'
import type {
  DiscordSource,
  MessagePage,
  ReadMessagesQuery,
} from '../usecases/ports'
import { assertDiscordResponse, escapeXml } from './shared'
import { withRetry } from '../services/retry'
import { TOKENS } from '../tokens'

const DISCORD_EPOCH = 1420070400000n
const MAX_MESSAGES_PER_REQUEST = 100

/** The smallest message id Discord could have issued at that instant. */
function snowflakeAt(time: Date): bigint {
  return (BigInt(time.getTime()) - DISCORD_EPOCH) << 22n
}

// https://docs.discord.com/developers/resources/message#message-object-message-types
const REPLY_MESSAGE_TYPE = 19

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
  message_reference?: { message_id?: string }
  /** Null once the replied-to message has been deleted. */
  referenced_message?: { id: string; author: DiscordUser } | null
}

const displayName = (user: DiscordUser) =>
  escapeXml(user.global_name ?? user.username)

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
        ? `<reply-to id="${target.id}"${selfMark(target.author)}>${displayName(target.author)}</reply-to>`
        : `<reply-to id="${repliedToId}"/>`,
    )
  }

  parts.push(`<content>${escapeXml(msg.content)}</content>`)

  if (msg.attachments.length > 0) {
    const attachmentLines = msg.attachments
      .map((a) => `${escapeXml(a.filename)} - ${a.url}`)
      .join('\n')
    parts.push(`<attachments size="${msg.attachments.length}">`)
    parts.push(attachmentLines)
    parts.push('</attachments>')
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
      collected.push(...inRange.filter((msg) => msg.content))

      exhausted = batch.length < pageSize || inRange.length < batch.length
      if (!exhausted) after = batch[batch.length - 1].id
    }

    if (fetched > 0 && collected.length === 0) {
      console.warn(
        `Discord returned ${fetched} messages but all had empty content. ` +
          'Ensure the MESSAGE_CONTENT privileged intent is enabled in the Discord Developer Portal.',
      )
    }

    return {
      messages: collected.map((msg) => formatMessageToXml(msg, this.selfId)),
      nextCursor: exhausted ? null : after,
    }
  }

  private async fetchMessages(
    after: string,
    limit: number,
  ): Promise<DiscordMessage[]> {
    const url = `https://discord.com/api/v10/channels/${this.channelId}/messages?after=${after}&limit=${limit}`

    return withRetry(
      async () => {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bot ${this.botToken}`,
          },
        })
        await assertDiscordResponse(response)
        // Discord answers newest first, even when paging forward with `after`.
        return ((await response.json()) as DiscordMessage[]).reverse()
      },
      {
        onRetry: (error, attempt) => {
          console.warn(
            `Discord fetchMessages retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )
  }
}
