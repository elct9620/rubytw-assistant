import { injectable, inject } from 'tsyringe'
import type {
  SummaryPresenter,
  SummaryResult,
  SummarySuccess,
  SummaryFallback,
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
    switch (result.kind) {
      case 'empty':
        await this.notifier.sendMessage(this.channelId, NO_ACTION_ITEMS_NOTICE)
        return
      case 'success':
        await this.presentSuccess(result)
        return
      case 'fallback':
        await this.presentFallback(result)
        return
    }
  }

  private async presentSuccess(result: SummarySuccess): Promise<void> {
    if (result.actionItems.length === 0) {
      await this.notifier.sendMessage(this.channelId, NO_ACTION_ITEMS_NOTICE)
      return
    }

    const capped = result.actionItems.slice(0, MAX_ACTION_ITEMS)
    const body = formatActionItems(capped)
    await this.sendChunked(body)
  }

  private async presentFallback(result: SummaryFallback): Promise<void> {
    const notice = `⚠️ AI 分析失敗，改傳原始訊息以利人工檢視。\n失敗原因：${result.reason}`
    await this.notifier.sendMessage(this.channelId, notice)

    if (result.rawMessages.length === 0) return
    await this.sendChunked(result.rawMessages.join('\n'))
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
