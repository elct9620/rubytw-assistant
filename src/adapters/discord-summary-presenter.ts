import { injectable, inject } from 'tsyringe'
import type {
  SummaryPresenter,
  SummaryResult,
  DiscordNotifier,
} from '../usecases/ports'
import { formatFollowUpItems } from '../entities/follow-up-item'
import { TOKENS } from '../tokens'

const DISCORD_MAX_CONTENT_LENGTH = 2000

@injectable()
export class DiscordSummaryPresenter implements SummaryPresenter {
  constructor(
    @inject(TOKENS.DiscordNotifier) private notifier: DiscordNotifier,
    @inject(TOKENS.DiscordChannelId) private channelId: string,
    @inject(TOKENS.SummaryItemLimit) private summaryItemLimit: number,
  ) {}

  /** A failed run sends nothing: the channel carries reminders only, and the logged error reaches operators. */
  async present(result: SummaryResult): Promise<void> {
    if (result.kind === 'failure' || result.items.length === 0) return

    const capped = result.items.slice(0, this.summaryItemLimit)
    const body = formatFollowUpItems(capped)
    await this.sendChunked(body)
  }

  private async sendChunked(body: string): Promise<void> {
    const chunks = chunkForDiscord(body)
    for (const chunk of chunks) {
      await this.notifier.sendMessage(this.channelId, chunk)
    }
  }
}

function chunkForDiscord(body: string): string[] {
  const lines = body.split('\n')
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line
    if (next.length > DISCORD_MAX_CONTENT_LENGTH && current) {
      chunks.push(current)
      current =
        line.length > DISCORD_MAX_CONTENT_LENGTH
          ? line.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3) + '...'
          : line
    } else if (!current && line.length > DISCORD_MAX_CONTENT_LENGTH) {
      current = line.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3) + '...'
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks
}
