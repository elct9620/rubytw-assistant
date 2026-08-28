import { isStepCount, NoOutputGeneratedError, Output } from 'ai'
import { generateText } from './ai-sdk'
import type { Telemetry, ToolSet } from 'ai'
import type { z } from 'zod'
import { createAIModel } from './ai-model'
import { withRetry } from './retry'
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
  telemetry: Telemetry | null
}

/**
 * Thin wrapper around the AI SDK's `generateText` for structured output
 * with tool use. Handles:
 *
 *  - model construction via createAIModel
 *  - Output.object schema binding
 *  - optional Langfuse telemetry when an integration is provided
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
  telemetry,
}: RunStructuredAIOptions<S>): Promise<z.infer<S>> {
  return withRetry(
    () =>
      generateOnce({
        operation,
        config,
        system,
        prompt,
        schema,
        tools,
        telemetry,
      }),
    {
      onRetry: (error, attempt) => {
        console.warn(
          `runStructuredAI(${operation}) retry ${attempt}:`,
          error instanceof Error ? error.message : error,
        )
      },
    },
  )
}

async function generateOnce<S extends z.ZodTypeAny>({
  operation,
  config,
  system,
  prompt,
  schema,
  tools,
  telemetry,
}: RunStructuredAIOptions<S>): Promise<z.infer<S>> {
  const result = await generateText({
    model: createAIModel(config),
    output: Output.object({ schema }),
    instructions: system,
    prompt,
    providerOptions: { openai: { reasoningEffort: 'low' } },
    tools,
    stopWhen: isStepCount(MAX_TOOL_STEPS),
    // `@ai-sdk/otel` fixes the span name to `${operation} ${model}`, so this
    // surfaces as `gen_ai.agent.name` rather than in the observation title —
    // enough to tell the three AI steps apart by attribute and filter.
    ...(telemetry && {
      telemetry: { integrations: telemetry, functionId: operation },
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
