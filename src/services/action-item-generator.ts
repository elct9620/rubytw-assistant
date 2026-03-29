import { injectable, inject } from 'tsyringe'
import { generateText, Output, stepCountIs } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import { z } from 'zod'
import type {
  ActionItemGenerator,
  GitHubSource,
  MemoryStore,
} from '../usecases/ports'
import type { ActionItem } from '../entities/action-item'
import type { TopicGroup } from '../entities/topic-group'
import { TOKENS, type AiGatewayConfig } from '../tokens'
import { createAITools } from './ai-tools'
import GENERATE_ACTION_ITEMS_PROMPT from '../prompts/generate-action-items.md'

const MAX_TOOL_STEPS = 5

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
export class ActionItemGeneratorService implements ActionItemGenerator {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryStore) private memoryStore: MemoryStore,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.GitHubSource) private githubSource: GitHubSource,
  ) {}

  async generateActionItems(groups: TopicGroup[]): Promise<ActionItem[]> {
    const today = new Date().toISOString().slice(0, 10)
    const system = GENERATE_ACTION_ITEMS_PROMPT.replace(
      '{{today}}',
      today,
    ).replace('{{memoryEntryLimit}}', String(this.memoryEntryLimit))
    const tools = createAITools({
      memoryStore: this.memoryStore,
      githubSource: this.githubSource,
      memoryEntryLimit: this.memoryEntryLimit,
    })
    const { output } = await generateText({
      model: this.createModel(),
      output: Output.object({ schema: GenerateActionItemsOutputSchema }),
      system,
      prompt: JSON.stringify(groups),
      temperature: 0.3,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    })

    if (!output) {
      throw new Error(
        'AI service returned no structured output for generateActionItems',
      )
    }

    return output.items
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
