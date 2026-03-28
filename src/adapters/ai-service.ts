import { injectable, inject } from 'tsyringe'
import { generateText, Output, tool, stepCountIs } from 'ai'
import type { ToolSet } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import { z } from 'zod'
import type {
  ConversationGrouper,
  ActionItemGenerator,
  MemoryStore,
} from '../usecases/ports'
import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import { TOKENS } from '../tokens'
import PHASE1_SYSTEM_PROMPT from '../prompts/phase1-group-conversations.md'
import PHASE2_SYSTEM_PROMPT from '../prompts/phase2-generate-action-items.md'

const ACCOUNT_ID = '614fcd230e7a893b205fd36259d9aff3'
const GATEWAY_ID = 'rubytw-assistant'
const MAX_TOOL_STEPS = 5

const TopicGroupSchema = z.object({
  topic: z.string().describe('topic title'),
  summary: z.string().describe('topic summary'),
  communityRelated: z.enum(['yes', 'no']).describe('whether community related'),
  smallTalk: z.enum(['yes', 'no']).describe('whether small talk'),
  lostContext: z.enum(['yes', 'no']).describe('whether context is lost'),
})

const Phase1OutputSchema = z.object({
  groups: z.array(TopicGroupSchema),
})

const ActionItemSchema = z.object({
  status: z
    .enum(['to-do', 'in-progress', 'done', 'stalled', 'discussion'])
    .describe('action item status'),
  description: z.string().describe('task description'),
  assignee: z.string().describe('assignee'),
  reason: z.string().describe('reason'),
})

const Phase2OutputSchema = z.object({
  items: z.array(ActionItemSchema),
})

@injectable()
export class AIServiceAdapter
  implements ConversationGrouper, ActionItemGenerator
{
  constructor(
    @inject(TOKENS.CfAigToken) private apiKey: string,
    @inject(TOKENS.AiModel) private modelId: string,
    @inject(TOKENS.MemoryStore) private memoryStore: MemoryStore,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
  ) {}

  async groupConversations(messages: string[]): Promise<TopicGroup[]> {
    const system = PHASE1_SYSTEM_PROMPT.replace(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    )
    const tools = this.createMemoryTools()

    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: Phase1OutputSchema }),
      system,
      prompt: messages.join('\n'),
      temperature: 0.3,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    })

    if (!output) {
      throw new Error('AI service returned no structured output for Phase 1')
    }

    return output.groups
  }

  async generateActionItems(groups: TopicGroup[]): Promise<ActionItem[]> {
    const today = new Date().toISOString().slice(0, 10)
    const system = PHASE2_SYSTEM_PROMPT.replace('{{today}}', today).replace(
      '{{memoryEntryLimit}}',
      String(this.memoryEntryLimit),
    )
    const tools = this.createMemoryTools()

    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: Phase2OutputSchema }),
      system,
      prompt: JSON.stringify(groups),
      temperature: 0.3,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    })

    if (!output) {
      throw new Error('AI service returned no structured output for Phase 2')
    }

    return output.items
  }

  private createMemoryTools(): ToolSet {
    const store = this.memoryStore
    const limit = this.memoryEntryLimit

    return {
      memory_read: tool({
        description:
          'Read all memory entries from persistent store to recall context from previous executions',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const entries = await store.list()
            return { entries, count: entries.length, limit }
          } catch {
            console.warn('Memory read failed')
            return { entries: [], count: 0, limit, error: 'read failed' }
          }
        },
      }),
      memory_write: tool({
        description:
          'Write a memory entry to persistent store for future executions',
        inputSchema: z.object({
          key: z.string().describe('unique identifier for this memory entry'),
          content: z.string().describe('the information to remember'),
          tag: z.string().optional().describe('category tag for organization'),
        }),
        execute: async ({ key, content, tag }) => {
          try {
            await store.put({
              key,
              content,
              tag,
              updatedAt: new Date().toISOString(),
            })
            return { success: true }
          } catch (e) {
            console.warn('Memory write failed:', e)
            return {
              success: false,
              error: 'write failed - entry limit may be reached',
            }
          }
        },
      }),
      memory_delete: tool({
        description:
          'Delete a memory entry from persistent store to free space',
        inputSchema: z.object({
          key: z.string().describe('key of the entry to delete'),
        }),
        execute: async ({ key }) => {
          try {
            await store.delete(key)
            return { success: true }
          } catch {
            console.warn('Memory delete failed')
            return { success: false, error: 'delete failed' }
          }
        },
      }),
    }
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
