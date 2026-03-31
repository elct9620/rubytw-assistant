import { injectable, inject } from 'tsyringe'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'
import type {
  ConversationGrouper,
  GitHubSource,
  MemoryStore,
} from '../usecases/ports'
import type { TopicGroup } from '../entities/topic-group'
import { TOKENS, type AiGatewayConfig, type LangfuseConfig } from '../tokens'
import type { RequestContext } from '../context'
import { createAITools } from './ai-tools'
import { createAIModel } from './ai-model'
import { createTelemetryContext } from '../telemetry/context'
import GROUP_CONVERSATIONS_PROMPT from '../prompts/group-conversations.md'

const MAX_TOOL_STEPS = 5

const TopicGroupSchema = z.object({
  topic: z.string().describe('topic title'),
  summary: z.string().describe('topic summary'),
  communityRelated: z
    .enum(['yes', 'no'])
    .describe('whether related to Ruby Taiwan community operations'),
  smallTalk: z
    .enum(['yes', 'no'])
    .describe(
      'whether casual conversation without actionable content for Ruby Taiwan',
    ),
  lostContext: z.enum(['yes', 'no']).describe('whether context is lost'),
})

const GroupConversationsOutputSchema = z.object({
  groups: z.array(TopicGroupSchema),
})

@injectable()
export class ConversationGrouperService implements ConversationGrouper {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryStore) private memoryStore: MemoryStore,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.MemoryDescriptionLimit)
    private memoryDescriptionLimit: number,
    @inject(TOKENS.GitHubSource) private githubSource: GitHubSource,
    @inject(TOKENS.LangfuseConfig)
    private langfuseConfig: LangfuseConfig | null,
    @inject(TOKENS.RequestContext) private ctx: RequestContext,
  ) {}

  async groupConversations(messages: string[]): Promise<TopicGroup[]> {
    const system = GROUP_CONVERSATIONS_PROMPT.replace(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    )
    const tools = createAITools({
      memoryStore: this.memoryStore,
      githubSource: this.githubSource,
      memoryEntryLimit: this.memoryEntryLimit,
      memoryDescriptionLimit: this.memoryDescriptionLimit,
    })
    const { integrations } = createTelemetryContext(this.langfuseConfig, {
      traceId: this.ctx.traceId,
      agentName: 'conversation-grouper',
    })

    const { output } = await generateText({
      model: createAIModel(this.aiGatewayConfig),
      output: Output.object({ schema: GroupConversationsOutputSchema }),
      system,
      prompt: messages.join('\n'),
      providerOptions: { openai: { reasoningEffort: 'low' } },
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      ...(integrations && {
        experimental_telemetry: { isEnabled: true, integrations },
      }),
    })

    if (!output) {
      throw new Error(
        'AI service returned no structured output for groupConversations',
      )
    }

    return output.groups
  }
}
