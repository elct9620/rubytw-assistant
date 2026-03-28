import { generateText, Output } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import { z } from 'zod'
import type {
  ConversationGrouper,
  ActionItemGenerator,
} from '../usecases/generate-summary'
import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import PHASE1_SYSTEM_PROMPT from '../prompts/phase1-group-conversations.md'
import PHASE2_SYSTEM_PROMPT from '../prompts/phase2-generate-action-items.md'

const ACCOUNT_ID = '614fcd230e7a893b205fd36259d9aff3'
const GATEWAY_ID = 'rubytw-assistant'

const TopicGroupSchema = z.object({
  topic: z.string().describe('主題名稱'),
  summary: z.string().describe('主題摘要'),
  communityRelated: z.enum(['yes', 'no']).describe('是否與社群活動相關'),
  smallTalk: z.enum(['yes', 'no']).describe('是否為閒聊'),
  lostContext: z.enum(['yes', 'no']).describe('是否缺乏足夠上下文'),
})

const Phase1OutputSchema = z.object({
  groups: z.array(TopicGroupSchema),
})

const ActionItemSchema = z.object({
  status: z
    .enum(['to-do', 'in-progress', 'done', 'stalled', 'discussion'])
    .describe('待辦事項狀態'),
  description: z.string().describe('任務描述'),
  assignee: z.string().describe('負責人'),
  reason: z.string().describe('原因'),
})

const Phase2OutputSchema = z.object({
  items: z.array(ActionItemSchema),
})

export class AIServiceAdapter
  implements ConversationGrouper, ActionItemGenerator
{
  constructor(
    private apiKey: string,
    private modelId: string,
  ) {}

  async groupConversations(messages: string[]): Promise<TopicGroup[]> {
    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: Phase1OutputSchema }),
      system: PHASE1_SYSTEM_PROMPT,
      prompt: messages.join('\n'),
      temperature: 0.3,
    })

    if (!output) {
      throw new Error('AI service returned no structured output for Phase 1')
    }

    return output.groups
  }

  async generateActionItems(groups: TopicGroup[]): Promise<ActionItem[]> {
    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: Phase2OutputSchema }),
      system: PHASE2_SYSTEM_PROMPT,
      prompt: JSON.stringify(groups),
      temperature: 0.3,
    })

    if (!output) {
      throw new Error('AI service returned no structured output for Phase 2')
    }

    return output.items
  }

  private createModel() {
    const aigateway = createAiGateway({
      accountId: ACCOUNT_ID,
      gateway: GATEWAY_ID,
      apiKey: this.apiKey,
    })
    const unified = createUnified()
    return aigateway(unified(this.modelId))
  }
}
