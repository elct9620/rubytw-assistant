import { injectable, inject } from 'tsyringe'
import { generateText, NoOutputGeneratedError, Output, stepCountIs } from 'ai'
import type { Tracer } from '@opentelemetry/api'
import { z } from 'zod'
import type {
  ConversationGrouper,
  GitHubSource,
  MemoryStore,
} from '../usecases/ports'
import type { TopicGroup } from '../entities/topic-group'
import { TOKENS, type AiGatewayConfig } from '../tokens'
import { createAITools } from './ai-tools'
import { createAIModel } from './ai-model'
import GROUP_CONVERSATIONS_PROMPT from '../prompts/group-conversations.md'

const MAX_TOOL_STEPS = 30

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
    @inject(TOKENS.Tracer) private tracer: Tracer | null,
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
    const result = await generateText({
      model: createAIModel(this.aiGatewayConfig),
      output: Output.object({ schema: GroupConversationsOutputSchema }),
      system,
      prompt: messages.join('\n'),
      providerOptions: { openai: { reasoningEffort: 'low' } },
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      ...(this.tracer && {
        experimental_telemetry: { isEnabled: true, tracer: this.tracer },
      }),
    })

    let output: typeof result.output
    try {
      output = result.output
    } catch (error) {
      if (NoOutputGeneratedError.isInstance(error)) {
        throw new Error(
          `groupConversations: no output generated (steps: ${result.steps.length}, finishReason: ${result.finishReason})`,
          { cause: error },
        )
      }
      throw error
    }

    if (!output) {
      throw new Error(
        'AI service returned no structured output for groupConversations',
      )
    }

    return output.groups
  }
}
