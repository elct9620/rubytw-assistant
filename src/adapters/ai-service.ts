import { generateText, Output } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import { z } from 'zod'
import type { ConversationGrouper } from '../usecases/generate-summary'
import type { ActionItemGenerator } from '../usecases/generate-summary'
import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'

const ACCOUNT_ID = '614fcd230e7a893b205fd36259d9aff3'
const GATEWAY_ID = 'rubytw-assistant'

const PHASE1_SYSTEM_PROMPT = `你是 Ruby Taiwan 社群的營運助手。分析以下 Discord 訊息，將它們按主題分組。

規則：
- 根據對話脈絡將訊息分組為不同主題
- 每個主題提供摘要
- 標記每個主題的屬性：
  - communityRelated: 是否與 Ruby Taiwan 社群活動相關
  - smallTalk: 是否為閒聊（無可行動內容）
  - lostContext: 是否缺乏足夠上下文判斷意圖`

const PHASE2_SYSTEM_PROMPT = `你是 Ruby Taiwan 社群的營運助手。根據主題分組產生待辦事項清單。

規則：
- 每個主題群組最多產生一個待辦事項
- status 必須是：to-do、in-progress、done、stalled、discussion 之一
- assignee 填入負責人（若無法判斷則填「未指定」）
- reason 說明為何需要此待辦事項
- description 簡潔描述任務內容`

const TopicGroupSchema = z.object({
  topic: z.string().describe('主題名稱'),
  summary: z.string().describe('主題摘要'),
  communityRelated: z.enum(['yes', 'no']).describe('是否與社群活動相關'),
  smallTalk: z.enum(['yes', 'no']).describe('是否為閒聊'),
  lostContext: z.enum(['yes', 'no']).describe('���否缺乏足夠上下文'),
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
