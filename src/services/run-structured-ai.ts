import { generateText, NoOutputGeneratedError, Output, stepCountIs } from 'ai'
import type { ToolSet } from 'ai'
import type { Tracer } from '@opentelemetry/api'
import type { z } from 'zod'
import { createAIModel } from './ai-model'
import type { AiGatewayConfig } from '../tokens'

export const MAX_TOOL_STEPS = 30

export interface RunStructuredAIOptions<S extends z.ZodTypeAny> {
  /** Label used in error messages, e.g. "groupConversations". */
  operation: string
  config: AiGatewayConfig
  system: string
  prompt: string
  schema: S
  tools: ToolSet
  tracer: Tracer | null
}

/**
 * Thin wrapper around the AI SDK's `generateText` for structured output
 * with tool use. Handles:
 *
 *  - model construction via createAIModel
 *  - Output.object schema binding
 *  - optional experimental_telemetry when a tracer is provided
 *  - MAX_TOOL_STEPS guard
 *  - NoOutputGeneratedError unwrapping with diagnostic context
 *  - null-output guard
 *
 * Both ConversationGrouperService and ActionItemGeneratorService share
 * this exact pipeline; keeping it here avoids duplication and makes the
 * two services parallel structurally.
 */
export async function runStructuredAI<S extends z.ZodTypeAny>({
  operation,
  config,
  system,
  prompt,
  schema,
  tools,
  tracer,
}: RunStructuredAIOptions<S>): Promise<z.infer<S>> {
  const result = await generateText({
    model: createAIModel(config),
    output: Output.object({ schema }),
    system,
    prompt,
    providerOptions: { openai: { reasoningEffort: 'low' } },
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    ...(tracer && {
      experimental_telemetry: { isEnabled: true, tracer },
    }),
  })

  let output: typeof result.output
  try {
    output = result.output
  } catch (error) {
    if (NoOutputGeneratedError.isInstance(error)) {
      throw new Error(
        `${operation}: no output generated (steps: ${result.steps.length}, finishReason: ${result.finishReason})`,
        { cause: error },
      )
    }
    throw error
  }

  if (!output) {
    throw new Error(`AI service returned no structured output for ${operation}`)
  }

  return output as z.infer<S>
}
