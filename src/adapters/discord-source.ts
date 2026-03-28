import type { DiscordSource } from '../usecases/generate-summary'

type FetchFn = typeof fetch

const DISCORD_EPOCH = 1420070400000n
const MAX_MESSAGES_PER_REQUEST = 100

interface DiscordMessage {
  id: string
  content: string
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
    const messages: string[] = []

    for (;;) {
      const batch = await this.fetchMessages(afterSnowflake)
      for (const msg of batch) {
        if (msg.content) {
          messages.push(msg.content)
        }
      }

      if (batch.length < MAX_MESSAGES_PER_REQUEST) break
      afterSnowflake = batch[batch.length - 1].id
    }

    return messages
  }

  private async fetchMessages(after: string): Promise<DiscordMessage[]> {
    const url = `https://discord.com/api/v10/channels/${this.channelId}/messages?after=${after}&limit=${MAX_MESSAGES_PER_REQUEST}`
    const response = await this.fetchFn(url, {
      headers: {
        Authorization: `Bot ${this.botToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(
        `Discord API error: ${response.status} ${response.statusText}`,
      )
    }

    return (await response.json()) as DiscordMessage[]
  }
}
