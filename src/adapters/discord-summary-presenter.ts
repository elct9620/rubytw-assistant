import { injectable, inject } from 'tsyringe'
import type {
  SummaryPresenter,
  SummaryResult,
  DiscordNotifier,
} from '../usecases/ports'
import { formatActionItems } from '../entities/action-item'
import { TOKENS } from '../tokens'

const MAX_ACTION_ITEMS = 30
const DISCORD_MAX_CONTENT_LENGTH = 2000
const NO_ACTION_ITEMS_NOTICE = '本次摘要期間內無待辦事項。'

@injectable()
export class DiscordSummaryPresenter implements SummaryPresenter {
  constructor(
    @inject(TOKENS.DiscordNotifier) private notifier: DiscordNotifier,
    @inject(TOKENS.DiscordChannelId) private channelId: string,
  ) {}

  async present(result: SummaryResult): Promise<void> {
    if (result.actionItems.length === 0) {
      await this.notifier.sendMessage(this.channelId, NO_ACTION_ITEMS_NOTICE)
      return
    }

    const capped = result.actionItems.slice(0, MAX_ACTION_ITEMS)
    const lines = formatActionItems(capped).split('\n')

    const chunks: string[] = []
    let current = ''

    for (const line of lines) {
      const next = current ? `${current}\n${line}` : line
      if (next.length > DISCORD_MAX_CONTENT_LENGTH && current) {
        chunks.push(current)
        current = line
      } else {
        current = next
      }
    }
    if (current) chunks.push(current)

    for (const chunk of chunks) {
      await this.notifier.sendMessage(this.channelId, chunk)
    }
  }
}
