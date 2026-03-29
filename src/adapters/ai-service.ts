import { injectable, inject } from 'tsyringe'
import { generateText, Output, tool, stepCountIs } from 'ai'
import type { ToolSet } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import { z } from 'zod'
import type {
  ConversationGrouper,
  ActionItemGenerator,
  GitHubSource,
  MemoryStore,
} from '../usecases/ports'
import type { TopicGroup } from '../entities/topic-group'
import type { ActionItem } from '../entities/action-item'
import { TOKENS, type AiGatewayConfig } from '../tokens'
import GROUP_CONVERSATIONS_PROMPT from '../prompts/group-conversations.md'
import GENERATE_ACTION_ITEMS_PROMPT from '../prompts/generate-action-items.md'

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

const ActionItemSchema = z.object({
  status: z
    .enum(['to-do', 'in-progress', 'done', 'stalled', 'discussion'])
    .describe('action item status'),
  description: z.string().describe('task description'),
  assignee: z.string().describe('assignee'),
  reason: z.string().describe('reason'),
})

const GenerateActionItemsOutputSchema = z.object({
  items: z.array(ActionItemSchema),
})

@injectable()
export class AIServiceAdapter
  implements ConversationGrouper, ActionItemGenerator
{
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
    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: GroupConversationsOutputSchema }),
      system,
      prompt: messages.join('\n'),
      temperature: 0.3,
      tools: this.createTools(),
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    })

    if (!output) {
      throw new Error(
        'AI service returned no structured output for groupConversations',
      )
    }

    return output.groups
  }

  async generateActionItems(groups: TopicGroup[]): Promise<ActionItem[]> {
    const today = new Date().toISOString().slice(0, 10)
    const system = GENERATE_ACTION_ITEMS_PROMPT.replace(
      '{{today}}',
      today,
    ).replace('{{memoryEntryLimit}}', String(this.memoryEntryLimit))
    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: GenerateActionItemsOutputSchema }),
      system,
      prompt: JSON.stringify(groups),
      temperature: 0.3,
      tools: this.createTools(),
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    })

    if (!output) {
      throw new Error(
        'AI service returned no structured output for generateActionItems',
      )
    }

    return output.items
  }

  private createTools(): ToolSet {
    return { ...this.createMemoryTools(), ...this.createGitHubTools() }
  }

  private createGitHubTools(): ToolSet {
    const source = this.githubSource

    return {
      github_get_issues: tool({
        description:
          'Query GitHub Projects V2 issues to check task status and relate conversations to existing issues',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const issues = await source.getIssues()
            return { issues, count: issues.length }
          } catch {
            console.warn('GitHub get issues failed')
            return { issues: [], count: 0, error: 'query failed' }
          }
        },
      }),
      github_get_project_activities: tool({
        description:
          'Query GitHub Projects V2 recent activities to understand project progress',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const activities = await source.getProjectActivities()
            return { activities, count: activities.length }
          } catch {
            console.warn('GitHub get project activities failed')
            return { activities: [], count: 0, error: 'query failed' }
          }
        },
      }),
    }
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
    const { accountId, gatewayId, apiKey, modelId } = this.aiGatewayConfig
    const aigateway = createAiGateway({
      accountId,
      gateway: gatewayId,
      apiKey,
    })
    const unified = createUnified()
    return aigateway(unified(modelId))
  }
}
