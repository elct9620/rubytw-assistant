import { injectable, inject } from 'tsyringe'
import { isStepCount, tool, ToolLoopAgent } from 'ai'
import type { Telemetry } from 'ai'
import { z } from 'zod'
import type { MemoryAgent, MemoryStore } from '../usecases/ports'
import { taiwanDate } from '../entities/taiwan-date'
import { TOKENS, type AiGatewayConfig } from '../tokens'
import { createAIModel } from './ai-model'
import { invokeAgent } from './cloudflare-ai-telemetry'
import { createMemoryTools } from './ai-tools'
import {
  acceptedSubmission,
  isSubmissionAccepted,
  SUBMIT_TOOL,
} from './submission'
import MEMORY_AGENT_PROMPT from '../prompts/memory-agent.md'

const MAX_STEPS = 30
const AGENT_NAME = 'memoryAgent'

const BriefingSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .describe('the briefing, in plain-text Traditional Chinese (Taiwan)'),
})

/** Refuses a briefing over the limit instead of cutting it, so the agent shortens it itself. */
function createBriefingSubmitTool(lengthLimit: number) {
  return tool({
    description: `Hand in the Memory Summary briefing, at most ${lengthLimit} characters. A longer one is refused; shorten it and submit again.`,
    inputSchema: BriefingSchema,
    execute: async ({ summary }) =>
      summary.length <= lengthLimit
        ? { accepted: true }
        : {
            accepted: false,
            reason: `${summary.length} characters; the limit is ${lengthLimit}`,
          },
  })
}

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

    const today = taiwanDate()
    const agent = new ToolLoopAgent({
      model: createAIModel(this.aiGatewayConfig),
      instructions: MEMORY_AGENT_PROMPT.replaceAll(
        '{{memoryEntryLimit}}',
        String(this.memoryEntryLimit),
      )
        .replaceAll('{{memorySummaryLengthLimit}}', String(this.lengthLimit))
        .replaceAll('{{today}}', today),
      tools: {
        ...createMemoryTools({
          memoryStore: this.memoryStore,
          memoryEntryLimit: this.memoryEntryLimit,
          memoryDescriptionLimit: this.memoryDescriptionLimit,
        }),
        [SUBMIT_TOOL]: createBriefingSubmitTool(this.lengthLimit),
      },
      // Every step must call a tool, so the run can only end through submit or the step cap.
      toolChoice: 'required',
      stopWhen: [isSubmissionAccepted, isStepCount(MAX_STEPS)],
      providerOptions: { openai: { reasoningEffort: 'high' } },
      telemetry: { integrations: this.telemetry, functionId: AGENT_NAME },
    })

    const { steps } = await invokeAgent(AGENT_NAME, () =>
      agent.generate({ prompt: 'Tidy memory, then submit the briefing.' }),
    )

    if (!(await this.hasMemory())) {
      return null
    }
    const submitted = acceptedSubmission(steps)
    if (submitted === undefined) {
      throw new Error(
        `stopped after ${steps.length} steps without an accepted summary`,
      )
    }
    return BriefingSchema.parse(submitted).summary
  }

  private async hasMemory(): Promise<boolean> {
    const slots = await this.memoryStore.list()
    return slots.some((slot) => slot.description !== '')
  }
}
