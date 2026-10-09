import { injectable, inject } from 'tsyringe'
import { isStepCount, ToolLoopAgent } from 'ai'
import type { Telemetry } from 'ai'
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
  acceptedSubmission,
  createEvidenceCheck,
  createSubmitTool,
  EvidenceSchema,
  isOverTokenBudget,
  isSubmissionAccepted,
  SUBMIT_TOOL,
  tokensSpent,
} from './evidence-check'
import FOLLOW_UP_PROMPT from '../prompts/follow-up.md'

/** Guards against a loop that never spends its budget, e.g. one stuck on empty tool results. */
const MAX_STEPS = 50
const AGENT_NAME = 'followUp'

const FollowUpListSchema = z.object({
  items: z.array(
    z.object({
      status: z
        .enum(['to-do', 'in-progress', 'stalled', 'abandoned'])
        .describe(
          'to-do: not started; in-progress: moved recently; stalled: reminded after 7 days without progress; abandoned: no progress 7 days after the reminder, listed this once',
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
    memorySummary?: string,
  ): Promise<FollowUpItem[]> {
    const today = taiwanDate()
    let instructions = FOLLOW_UP_PROMPT.replaceAll(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    ).replaceAll('{{today}}', today)
    if (memorySummary) {
      instructions += `\n\n# Memory Summary\n\n${memorySummary}`
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
      stopWhen: [
        isSubmissionAccepted,
        isOverTokenBudget(this.tokenBudget),
        isStepCount(MAX_STEPS),
      ],
      providerOptions: { openai: { reasoningEffort: 'high' } },
      telemetry: { integrations: this.telemetry, functionId: AGENT_NAME },
    })

    const { steps } = await invokeAgent(AGENT_NAME, () =>
      agent.generate({ prompt: messages.join('\n') }),
    )

    const spent = tokensSpent(steps)
    if (spent > this.tokenBudget) {
      throw new Error(
        `token budget exceeded (${spent} of ${this.tokenBudget} tokens)`,
      )
    }
    const submitted = acceptedSubmission(steps)
    if (submitted === undefined) {
      throw new Error(
        `stopped after ${steps.length} steps without an accepted list`,
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
