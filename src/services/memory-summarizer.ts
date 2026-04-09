import { injectable, inject } from 'tsyringe'
import { generateText } from 'ai'
import type { Tracer } from '@opentelemetry/api'
import type { MemorySummarizer, MemoryStore } from '../usecases/ports'
import { TOKENS, type AiGatewayConfig } from '../tokens'
import { createAIModel } from './ai-model'
import { withRetry } from './retry'
import SUMMARIZE_MEMORY_PROMPT from '../prompts/summarize-memory.md'

@injectable()
export class MemorySummarizerService implements MemorySummarizer {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryStore) private memoryStore: MemoryStore,
    @inject(TOKENS.MemorySummaryLengthLimit)
    private lengthLimit: number,
    @inject(TOKENS.Tracer) private tracer: Tracer | null,
  ) {}

  async summarize(): Promise<string | null> {
    const slots = await this.memoryStore.list()
    const nonEmptyIndices = slots
      .filter((s) => s.description !== '')
      .map((s) => s.index)

    if (nonEmptyIndices.length === 0) {
      return null
    }

    const details = await this.memoryStore.read(nonEmptyIndices)
    const markdown = details
      .map((d) => `## Slot ${d.index}: ${d.description}\n\n${d.content}`)
      .join('\n\n')

    const today = new Date().toISOString().slice(0, 10)
    const system = SUMMARIZE_MEMORY_PROMPT.replace(
      '{{memorySummaryLengthLimit}}',
      String(this.lengthLimit),
    ).replace('{{today}}', today)

    const text = await withRetry(
      async () => {
        const result = await generateText({
          model: createAIModel(this.aiGatewayConfig),
          system,
          prompt: markdown,
          providerOptions: { openai: { reasoningEffort: 'low' } },
          ...(this.tracer && {
            experimental_telemetry: { isEnabled: true, tracer: this.tracer },
          }),
        })
        return result.text
      },
      {
        onRetry: (error, attempt) => {
          console.warn(
            `MemorySummarizer retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )

    return text.slice(0, this.lengthLimit)
  }
}
