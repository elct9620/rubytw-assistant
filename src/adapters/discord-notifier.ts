import { injectable, inject } from 'tsyringe'
import type { DiscordNotifier } from '../usecases/ports'
import { type FetchFn, assertDiscordResponse } from './shared'
import { TOKENS } from '../tokens'

@injectable()
export class DiscordNotifierAdapter implements DiscordNotifier {
  constructor(
    @inject(TOKENS.DiscordBotToken) private botToken: string,
    private fetchFn: FetchFn = (...args) => fetch(...args),
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

    assertDiscordResponse(response)
  }
}
