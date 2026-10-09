import type {
  DiscordSource,
  FollowUpAgent,
  MemorySummaryStore,
  MemoryAgent,
  SummaryResult,
} from './ports'

const COLLECTION_MESSAGE_LIMIT = 500
const FOLLOW_UP_AGENT = 'Follow-up Agent'

export interface GenerateSummaryDeps {
  discord: Pick<DiscordSource, 'readMessages'>
  followUpAgent: FollowUpAgent
  memorySummaryStore: MemorySummaryStore
  memoryAgent: MemoryAgent
}

export class GenerateSummary {
  constructor(private deps: GenerateSummaryDeps) {}

  async execute(hours: number): Promise<SummaryResult> {
    const { messages } = await this.deps.discord.readMessages({
      since: new Date(Date.now() - hours * 3600 * 1000),
      limit: COLLECTION_MESSAGE_LIMIT,
    })

    let memorySummary: string | undefined
    try {
      memorySummary = (await this.deps.memorySummaryStore.read()) ?? undefined
    } catch (error) {
      console.warn(
        'Memory Summary Store read failed, skipping injection:',
        error,
      )
    }

    let items
    try {
      items = await this.deps.followUpAgent.followUp(messages, memorySummary)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(
        `${FOLLOW_UP_AGENT} failed, falling back to raw messages:`,
        error,
      )
      return {
        kind: 'fallback',
        rawMessages: messages,
        reason: `[${FOLLOW_UP_AGENT}] ${message}`,
      }
    }

    await this.runMemoryAgent()
    return { kind: 'success', items }
  }

  private async runMemoryAgent(): Promise<void> {
    try {
      const summary = await this.deps.memoryAgent.tidyAndSummarize()
      if (summary) {
        await this.deps.memorySummaryStore.write(summary)
      }
    } catch (error) {
      console.error('Memory Agent failed, skipping:', error)
    }
  }
}
