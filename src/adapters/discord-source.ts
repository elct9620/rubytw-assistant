import { injectable, inject } from 'tsyringe'
import type { DiscordSource } from '../usecases/ports'
import { type FetchFn, assertDiscordResponse, escapeXml } from './shared'
import { TOKENS } from '../tokens'

const DISCORD_EPOCH = 1420070400000n
const MAX_MESSAGES_PER_REQUEST = 100
const MAX_PAGES = 5

interface DiscordAuthor {
  id: string
  global_name: string | null
  username: string
  bot?: boolean
}

interface DiscordAttachment {
  filename: string
  url: string
}

interface DiscordMention {
  id: string
  global_name: string | null
  username: string
}

interface DiscordMessage {
  id: string
  content: string
  author: DiscordAuthor
  timestamp: string
  attachments: DiscordAttachment[]
  mentions: DiscordMention[]
}

export function formatMessageToXml(msg: DiscordMessage): string {
  const authorName = escapeXml(msg.author.global_name ?? msg.author.username)
  const isBot = msg.author.bot ?? false

  const parts = [
    `<item id="${msg.id}">`,
    `<user bot="${isBot}">${authorName}</user>`,
    `<timestamp>${msg.timestamp}</timestamp>`,
    `<content>${escapeXml(msg.content)}</content>`,
  ]

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
      .map(
        (m) =>
          `<user id="${m.id}">${escapeXml(m.global_name ?? m.username)}</user>`,
      )
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
    private fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  async getChannelMessages(hours: number): Promise<string[]> {
    const sinceMs = BigInt(Date.now() - hours * 3600 * 1000)
    let afterSnowflake = String((sinceMs - DISCORD_EPOCH) << 22n)
    const collected: DiscordMessage[] = []

    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.fetchMessages(afterSnowflake)
      for (const msg of batch) {
        if (msg.content) {
          collected.push(msg)
        }
      }

      if (batch.length < MAX_MESSAGES_PER_REQUEST) break
      afterSnowflake = batch[batch.length - 1].id
    }

    return collected.map(formatMessageToXml)
  }

  private async fetchMessages(after: string): Promise<DiscordMessage[]> {
    const url = `https://discord.com/api/v10/channels/${this.channelId}/messages?after=${after}&limit=${MAX_MESSAGES_PER_REQUEST}`
    const response = await this.fetchFn(url, {
      headers: {
        Authorization: `Bot ${this.botToken}`,
      },
    })

    assertDiscordResponse(response)

    return (await response.json()) as DiscordMessage[]
  }
}
