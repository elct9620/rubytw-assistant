import type { DiscordNotifier } from '../usecases/generate-summary'

type FetchFn = typeof fetch

export class DiscordNotifierAdapter implements DiscordNotifier {
  constructor(
    private botToken: string,
    private fetchFn: FetchFn = fetch,
  ) {}

  async sendMessage(channelId: string, content: string): Promise<void> {
    const response = await this.fetchFn(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      },
    )

    if (!response.ok) {
      throw new Error(
        `Discord API error: ${response.status} ${response.statusText}`,
      )
    }
  }
}
