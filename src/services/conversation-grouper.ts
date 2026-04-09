import { injectable, inject } from 'tsyringe'
import type { Tracer } from '@opentelemetry/api'
import { z } from 'zod'
import type { ConversationGrouper } from '../usecases/ports'
import type { TopicGroup } from '../entities/topic-group'
import { TOKENS, type AiGatewayConfig, type AIToolsFactory } from '../tokens'
import { runStructuredAI } from './run-structured-ai'
import GROUP_CONVERSATIONS_PROMPT from '../prompts/group-conversations.md'

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
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.AIToolsFactory) private toolsFactory: AIToolsFactory,
    @inject(TOKENS.Tracer) private tracer: Tracer | null,
  ) {}

  async groupConversations(
    messages: string[],
    memorySummary?: string,
  ): Promise<TopicGroup[]> {
    const today = new Date().toISOString().slice(0, 10)
    let system = GROUP_CONVERSATIONS_PROMPT.replace(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    ).replace('{{today}}', today)
    if (memorySummary) {
      system += `\n\n# Memory Summary\n\n${memorySummary}`
    }
    const tools = this.toolsFactory()

    const output = await runStructuredAI({
      operation: 'groupConversations',
      config: this.aiGatewayConfig,
      system,
      prompt: messages.join('\n'),
      schema: GroupConversationsOutputSchema,
      tools,
      tracer: this.tracer,
    })

    return output.groups
  }
}
