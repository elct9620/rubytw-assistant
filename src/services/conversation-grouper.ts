import { injectable, inject } from 'tsyringe'
import { generateText, Output, stepCountIs } from 'ai'
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

const MAX_TOOL_STEPS = 5

const TopicGroupSchema = z.object({
  topic: z.string().describe('topic title'),
  summary: z.string().describe('topic summary'),
  communityRelated: z.enum(['yes', 'no']).describe('whether community related'),
  smallTalk: z.enum(['yes', 'no']).describe('whether small talk'),
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
    @inject(TOKENS.GitHubSource) private githubSource: GitHubSource,
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
    })
    const { output } = await generateText({
      model: createAIModel(this.aiGatewayConfig),
      output: Output.object({ schema: GroupConversationsOutputSchema }),
      system,
      prompt: messages.join('\n'),
      temperature: 0.3,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    })

    if (!output) {
      throw new Error(
        'AI service returned no structured output for groupConversations',
      )
    }

    return output.groups
  }
}
