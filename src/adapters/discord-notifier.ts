import { injectable, inject } from 'tsyringe'
import type { DiscordNotifier } from '../usecases/ports'
import { assertDiscordResponse } from './shared'
import { withRetry } from '../services/retry'
import { TOKENS } from '../tokens'

@injectable()
export class DiscordNotifierAdapter implements DiscordNotifier {
  constructor(@inject(TOKENS.DiscordBotToken) private botToken: string) {}

  async sendMessage(channelId: string, content: string): Promise<void> {
    await withRetry(
      async () => {
        const response = await fetch(
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
        await assertDiscordResponse(response)
      },
      {
        onRetry: (error, attempt) => {
          console.warn(
            `Discord sendMessage retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )
  }
}
