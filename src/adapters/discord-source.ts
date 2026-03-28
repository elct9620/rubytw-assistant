import type { DiscordSource } from '../usecases/generate-summary'
import { type FetchFn, assertDiscordResponse } from './shared'

const DISCORD_EPOCH = 1420070400000n
const MAX_MESSAGES_PER_REQUEST = 100

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
  const authorName = msg.author.global_name ?? msg.author.username
  const isBot = msg.author.bot ?? false
  const attachmentLines = msg.attachments
    .map((a) => `${a.filename} - ${a.url}`)
    .join('\n')
  const mentionLines = msg.mentions
    .map((m) => `<user id="${m.id}">${m.global_name ?? m.username}</user>`)
    .join('\n')

  return `<item id="${msg.id}">
<user bot="${isBot}">${authorName}</user>
<timestamp>${msg.timestamp}</timestamp>
<content>${msg.content}</content>
<attachments size="${msg.attachments.length}">
${attachmentLines}
</attachments>
<mentions>
${mentionLines}
</mentions>
</item>`
}

export class DiscordSourceAdapter implements DiscordSource {
  constructor(
    private botToken: string,
    private channelId: string,
    private fetchFn: FetchFn = fetch,
  ) {}

  async getChannelMessages(hours: number): Promise<string[]> {
    const sinceMs = BigInt(Date.now() - hours * 3600 * 1000)
    let afterSnowflake = String((sinceMs - DISCORD_EPOCH) << 22n)
    const collected: DiscordMessage[] = []

    for (;;) {
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
