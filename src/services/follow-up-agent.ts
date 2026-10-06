import { injectable, inject } from 'tsyringe'
import { isStepCount, ToolLoopAgent } from 'ai'
import type { Telemetry } from 'ai'
import { z } from 'zod'
import type { FollowUpAgent } from '../usecases/ports'
import type { FollowUpItem } from '../entities/follow-up-item'
import { TOKENS, type AiGatewayConfig, type AIToolsFactory } from '../tokens'
import { createAIModel } from './ai-model'
import {
  acceptedSubmission,
  createSubmitTool,
  isOverTokenBudget,
  isSubmissionAccepted,
  SUBMIT_TOOL,
  tokensSpent,
} from './follow-up-goal'
import FOLLOW_UP_PROMPT from '../prompts/follow-up.md'

/** Guards against a loop that never spends its budget, e.g. one stuck on empty tool results. */
const MAX_STEPS = 50

const FollowUpListSchema = z.object({
  items: z.array(
    z.object({
      status: z
        .enum(['to-do', 'in-progress', 'stalled'])
        .describe(
          'to-do: not started; in-progress: moved recently; stalled: no movement or blocked',
        ),
      description: z
        .string()
        .describe('the next action the assignee must take'),
      assignee: z
        .string()
        .nullable()
        .describe(
          'person name exactly as it appears in conversation, or null if unassigned',
        ),
      lastProgress: z
        .string()
        .nullable()
        .describe(
          'YYYY-MM-DD people last moved the item, or null when no movement was found',
        ),
      reason: z.string().describe('why the item has this status'),
    }),
  ),
})

@injectable()
export class FollowUpAgentService implements FollowUpAgent {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.FollowUpTokenBudget) private tokenBudget: number,
    @inject(TOKENS.AIToolsFactory) private toolsFactory: AIToolsFactory,
    @inject(TOKENS.Telemetry) private telemetry: Telemetry | null,
  ) {}

  async followUp(
    messages: string[],
    memorySummary?: string,
  ): Promise<FollowUpItem[]> {
    const today = new Date().toISOString().slice(0, 10)
    let instructions = FOLLOW_UP_PROMPT.replace(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    ).replace('{{today}}', today)
    if (memorySummary) {
      instructions += `\n\n# Memory Summary\n\n${memorySummary}`
    }

    const agent = new ToolLoopAgent({
      model: createAIModel(this.aiGatewayConfig),
      instructions,
      tools: {
        ...this.toolsFactory(),
        [SUBMIT_TOOL]: createSubmitTool(FollowUpListSchema, messages),
      },
      // Every step must call a tool, so the run can only end through submit or a limit.
      toolChoice: 'required',
      stopWhen: [
        isSubmissionAccepted,
        isOverTokenBudget(this.tokenBudget),
        isStepCount(MAX_STEPS),
      ],
      providerOptions: { openai: { reasoningEffort: 'high' } },
      ...(this.telemetry && {
        telemetry: { integrations: this.telemetry, functionId: 'followUp' },
      }),
    })

    const { steps } = await agent.generate({ prompt: messages.join('\n') })

    const submitted = acceptedSubmission(steps)
    if (submitted === undefined) {
      const spent = tokensSpent(steps)
      throw new Error(
        spent > this.tokenBudget
          ? `token budget exceeded (${spent} of ${this.tokenBudget} tokens) before the list was accepted`
          : `stopped after ${steps.length} steps without an accepted list`,
      )
    }

    return FollowUpListSchema.parse(submitted).items
  }
}
