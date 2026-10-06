import { injectable, inject } from 'tsyringe'
import { isStepCount, ToolLoopAgent } from 'ai'
import type { Telemetry } from 'ai'
import type { MemoryAgent, MemoryStore } from '../usecases/ports'
import { TOKENS, type AiGatewayConfig } from '../tokens'
import { createAIModel } from './ai-model'
import { createMemoryTools } from './ai-tools'
import MEMORY_AGENT_PROMPT from '../prompts/memory-agent.md'

const MAX_STEPS = 30

@injectable()
export class MemoryAgentService implements MemoryAgent {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryStore) private memoryStore: MemoryStore,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.MemoryDescriptionLimit)
    private memoryDescriptionLimit: number,
    @inject(TOKENS.MemorySummaryLengthLimit)
    private lengthLimit: number,
    @inject(TOKENS.Telemetry) private telemetry: Telemetry[],
  ) {}

  async tidyAndSummarize(): Promise<string | null> {
    if (!(await this.hasMemory())) {
      return null
    }

    const today = new Date().toISOString().slice(0, 10)
    const agent = new ToolLoopAgent({
      model: createAIModel(this.aiGatewayConfig),
      instructions: MEMORY_AGENT_PROMPT.replaceAll(
        '{{memoryEntryLimit}}',
        String(this.memoryEntryLimit),
      )
        .replaceAll('{{memorySummaryLengthLimit}}', String(this.lengthLimit))
        .replaceAll('{{today}}', today),
      tools: createMemoryTools({
        memoryStore: this.memoryStore,
        memoryEntryLimit: this.memoryEntryLimit,
        memoryDescriptionLimit: this.memoryDescriptionLimit,
      }),
      stopWhen: isStepCount(MAX_STEPS),
      providerOptions: { openai: { reasoningEffort: 'high' } },
      telemetry: { integrations: this.telemetry, functionId: 'memoryAgent' },
    })

    const { text } = await agent.generate({
      prompt: 'Tidy memory, then summarize what remains.',
    })

    if (!(await this.hasMemory())) {
      return null
    }
    return text.trim().slice(0, this.lengthLimit) || null
  }

  private async hasMemory(): Promise<boolean> {
    const slots = await this.memoryStore.list()
    return slots.some((slot) => slot.description !== '')
  }
}
