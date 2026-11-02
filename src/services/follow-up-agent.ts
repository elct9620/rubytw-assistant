import { injectable, inject } from 'tsyringe'
import { isStepCount, ToolLoopAgent } from 'ai'
import type { StepResult, StopCondition, Telemetry, ToolSet } from 'ai'
import { z } from 'zod'
import type {
  DiscordSource,
  FollowUpAgent,
  GitHubSource,
} from '../usecases/ports'
import type { FollowUpItem } from '../entities/follow-up-item'
import { taiwanDate } from '../entities/taiwan-date'
import { TOKENS, type AiGatewayConfig, type AIToolsFactory } from '../tokens'
import { createAIModel } from './ai-model'
import { invokeAgent } from './cloudflare-ai-telemetry'
import { createRelevanceJudge } from './relevance-judge'
import {
  createEvidenceCheck,
  createSubmitTool,
  EvidenceSchema,
} from './evidence-check'
import {
  acceptedSubmission,
  isSubmissionAccepted,
  SUBMIT_TOOL,
} from './submission'
import FOLLOW_UP_PROMPT from '../prompts/follow-up.md'

/** Guards against a loop that never spends its budget, e.g. one stuck on empty tool results. */
const MAX_STEPS = 50
/** Steps left to hand in a list once the token budget is spent. */
const WRAP_UP_STEPS = 3
const AGENT_NAME = 'followUp'

const FollowUpListSchema = z.object({
  items: z.array(
    z.object({
      status: z
        .enum(['stalled', 'abandoned'])
        .describe(
          'stalled: reminded this run after 7 days without progress; abandoned: no progress 7 days after the reminder, listed this once',
        ),
      description: z
        .string()
        .describe(
          'the one next action, starting with a verb, within 20 characters',
        ),
      assignee: z
        .string()
        .nullable()
        .describe(
          'the person who spoke in the channel and owns the action, or null',
        ),
      lastProgress: z
        .string()
        .describe(
          'YYYY-MM-DD in Taiwan of the newest evidence: when people last committed to, discussed, or updated the Issue of the item',
        ),
      reason: z
        .string()
        .describe(
          'what the item waits on, or why it matters, within 15 characters',
        ),
      evidence: z
        .array(EvidenceSchema)
        .describe(
          'the messages people wrote and the Issues this item rests on; checked, never shown',
        ),
    }),
  ),
})

function tokensOf<TOOLS extends ToolSet>(step: StepResult<TOOLS>): number {
  return (
    step.usage.totalTokens ??
    (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0)
  )
}

/** The index of the step that went over the budget, or -1 while the run is within it. */
function budgetSpentAt<TOOLS extends ToolSet>(
  steps: StepResult<TOOLS>[],
  budget: number,
): number {
  let spent = 0
  return steps.findIndex((step) => (spent += tokensOf(step)) > budget)
}

function isWrapUpOver(budget: number): StopCondition<ToolSet> {
  return ({ steps }) => {
    const spentAt = budgetSpentAt(steps, budget)
    return spentAt >= 0 && steps.length - 1 - spentAt >= WRAP_UP_STEPS
  }
}

@injectable()
export class FollowUpAgentService implements FollowUpAgent {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.FollowUpTokenBudget) private tokenBudget: number,
    @inject(TOKENS.AIToolsFactory) private toolsFactory: AIToolsFactory,
    @inject(TOKENS.DiscordSource) private discord: DiscordSource,
    @inject(TOKENS.GitHubSource) private github: GitHubSource,
    @inject(TOKENS.Telemetry) private telemetry: Telemetry[],
  ) {}

  async followUp(
    messages: string[],
    hours: number,
    memorySummary?: string,
  ): Promise<FollowUpItem[]> {
    let instructions = FOLLOW_UP_PROMPT.replaceAll(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    )
      .replaceAll('{{today}}', taiwanDate())
      .replaceAll('{{hours}}', String(hours))
    if (memorySummary) {
      instructions += `\n\n# Community Situation\n\n${memorySummary}`
    }

    const model = createAIModel(this.aiGatewayConfig)
    const agent = new ToolLoopAgent({
      model,
      instructions,
      tools: {
        ...this.toolsFactory(),
        [SUBMIT_TOOL]: createSubmitTool(
          FollowUpListSchema,
          createEvidenceCheck({
            discord: this.discord,
            github: this.github,
            judge: createRelevanceJudge(model, this.telemetry),
          }),
        ),
      },
      // Every step must call a tool, so the run can only end through submit or a limit.
      toolChoice: 'required',
      prepareStep: ({ steps }) =>
        budgetSpentAt(steps, this.tokenBudget) >= 0
          ? { activeTools: [SUBMIT_TOOL] }
          : {},
      stopWhen: [
        isSubmissionAccepted,
        isWrapUpOver(this.tokenBudget),
        isStepCount(MAX_STEPS),
      ],
      providerOptions: { openai: { reasoningEffort: 'high' } },
      telemetry: { integrations: this.telemetry, functionId: AGENT_NAME },
    })

    const { steps } = await invokeAgent(AGENT_NAME, () =>
      agent.generate({ prompt: messages.join('\n') }),
    )

    const submitted = acceptedSubmission(steps)
    if (submitted === undefined) {
      throw new Error(
        budgetSpentAt(steps, this.tokenBudget) >= 0
          ? `token budget of ${this.tokenBudget} spent and wrap-up ended without an accepted list`
          : `stopped after ${steps.length} steps without an accepted list`,
      )
    }

    return FollowUpListSchema.parse(submitted).items.map((item) => ({
      status: item.status,
      description: item.description,
      assignee: item.assignee,
      lastProgress: item.lastProgress,
      reason: item.reason,
    }))
  }
}
