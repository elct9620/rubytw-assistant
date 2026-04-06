import { injectable, inject } from 'tsyringe'
import { generateText, NoOutputGeneratedError, Output, stepCountIs } from 'ai'
import type { Tracer } from '@opentelemetry/api'
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
import { createAIModel } from './ai-model'
import GENERATE_ACTION_ITEMS_PROMPT from '../prompts/generate-action-items.md'

const MAX_TOOL_STEPS = 30

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
    @inject(TOKENS.MemoryStore) private memoryStore: MemoryStore,
    @inject(TOKENS.MemoryEntryLimit) private memoryEntryLimit: number,
    @inject(TOKENS.MemoryDescriptionLimit)
    private memoryDescriptionLimit: number,
    @inject(TOKENS.GitHubSource) private githubSource: GitHubSource,
    @inject(TOKENS.Tracer) private tracer: Tracer | null,
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
      memoryDescriptionLimit: this.memoryDescriptionLimit,
    })
    const result = await generateText({
      model: createAIModel(this.aiGatewayConfig),
      output: Output.object({ schema: GenerateActionItemsOutputSchema }),
      system,
      prompt: JSON.stringify(groups),
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
          `generateActionItems: no output generated (steps: ${result.steps.length}, finishReason: ${result.finishReason})`,
          { cause: error },
        )
      }
      throw error
    }

    if (!output) {
      throw new Error(
        'AI service returned no structured output for generateActionItems',
      )
    }

    return output.items
  }
}
