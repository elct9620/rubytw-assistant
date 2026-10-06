import { injectable, inject } from 'tsyringe'
import type {
  SummaryPresenter,
  SummaryResult,
  SummarySuccess,
  SummaryFallback,
  DiscordNotifier,
} from '../usecases/ports'
import { formatFollowUpItems } from '../entities/follow-up-item'
import { TOKENS } from '../tokens'

const DISCORD_MAX_CONTENT_LENGTH = 2000
const EMPTY_WINDOW_NOTICE = '本次期間內頻道沒有新訊息。'
const NOTHING_PENDING_NOTICE = '本次摘要期間內無待辦事項。'

@injectable()
export class DiscordSummaryPresenter implements SummaryPresenter {
  constructor(
    @inject(TOKENS.DiscordNotifier) private notifier: DiscordNotifier,
    @inject(TOKENS.DiscordChannelId) private channelId: string,
    @inject(TOKENS.SummaryItemLimit) private summaryItemLimit: number,
  ) {}

  async present(result: SummaryResult): Promise<void> {
    switch (result.kind) {
      case 'empty':
        await this.notifier.sendMessage(this.channelId, EMPTY_WINDOW_NOTICE)
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
    if (result.items.length === 0) {
      await this.notifier.sendMessage(this.channelId, NOTHING_PENDING_NOTICE)
      return
    }

    const capped = result.items.slice(0, this.summaryItemLimit)
    const body = formatFollowUpItems(capped)
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
