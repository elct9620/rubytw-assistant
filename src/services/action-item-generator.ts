import { injectable, inject } from 'tsyringe'
import type { Tracer } from '@opentelemetry/api'
import { z } from 'zod'
import type { ActionItemGenerator } from '../usecases/ports'
import type { ActionItem } from '../entities/action-item'
import type { TopicGroup } from '../entities/topic-group'
import { TOKENS, type AiGatewayConfig, type AIToolsFactory } from '../tokens'
import { runStructuredAI } from './run-structured-ai'
import GENERATE_ACTION_ITEMS_PROMPT from '../prompts/generate-action-items.md'

const ActionItemSchema = z.object({
  status: z
    .enum(['to-do', 'in-progress', 'done', 'stalled', 'discussion'])
    .describe('action item status'),
  description: z.string().describe('task description'),
  assignee: z
    .string()
    .nullable()
    .describe(
      'person name exactly as it appears in conversation, or null if unassigned (never use generic labels like 社群成員)',
    ),
  reason: z.string().describe('reason'),
})

const GenerateActionItemsOutputSchema = z.object({
  items: z.array(ActionItemSchema),
})

@injectable()
export class ActionItemGeneratorService implements ActionItemGenerator {
  constructor(
    @inject(TOKENS.AiGatewayConfig) private aiGatewayConfig: AiGatewayConfig,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.AIToolsFactory) private toolsFactory: AIToolsFactory,
    @inject(TOKENS.Tracer) private tracer: Tracer | null,
  ) {}

  async generateActionItems(
    groups: TopicGroup[],
    memorySummary?: string,
  ): Promise<ActionItem[]> {
    const today = new Date().toISOString().slice(0, 10)
    let system = GENERATE_ACTION_ITEMS_PROMPT.replace(
      '{{today}}',
      today,
    ).replace('{{memoryEntryLimit}}', String(this.memoryEntryLimit))
    if (memorySummary) {
      system += `\n\n${memorySummary}`
    }
    const tools = this.toolsFactory()

    const output = await runStructuredAI({
      operation: 'generateActionItems',
      config: this.aiGatewayConfig,
      system,
      prompt: JSON.stringify(groups),
      schema: GenerateActionItemsOutputSchema,
      tools,
      tracer: this.tracer,
    })

    return output.items
  }
}
