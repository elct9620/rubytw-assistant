import { tracing } from 'cloudflare:workers'
import type { Telemetry } from 'ai'

/** Workers Observability drops span names over 64 UTF-8 bytes. */
const SPAN_NAME_LIMIT = 64

function spanName(operation: string, target: string): string {
  const name = `${operation} ${target}`
  return new TextEncoder().encode(name).length <= SPAN_NAME_LIMIT
    ? name
    : operation
}

interface ModelCallResult {
  usage?: {
    inputTokens?: { total?: number }
    outputTokens?: { total?: number }
  }
  response?: { headers?: Record<string, string | undefined> }
}

async function recordFailure<T>(span: Span, run: () => PromiseLike<T>) {
  try {
    return await run()
  } catch (error) {
    span.setStatus({
      code: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Mirrors AI model calls and tool runs into the platform's traces under GenAI
 * semantic-convention names; prompts and tool payloads are left out.
 */
export function createCloudflareAITelemetry(
  tracer: Pick<Tracing, 'enterSpan'> = tracing,
): Telemetry {
  return {
    executeLanguageModelCall: ({ provider, modelId, execute }) =>
      tracer.enterSpan(spanName('chat', modelId ?? 'unknown'), async (span) => {
        span.setAttributes({
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': provider,
          'gen_ai.request.model': modelId,
        })
        const result = await recordFailure(span, execute)
        const { usage, response } = result as ModelCallResult
        span.setAttributes({
          'gen_ai.usage.input_tokens': usage?.inputTokens?.total,
          'gen_ai.usage.output_tokens': usage?.outputTokens?.total,
          'cloudflare.ai_gateway.log.id': response?.headers?.['cf-aig-log-id'],
        })
        return result
      }),
    executeTool: ({ toolCall, toolCallId, execute }) => {
      const toolName = toolCall?.toolName ?? 'unknown'
      return tracer.enterSpan(spanName('execute_tool', toolName), (span) => {
        span.setAttributes({
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': toolName,
          'gen_ai.tool.call.id': toolCallId,
          'gen_ai.tool.type': 'function',
        })
        return recordFailure(span, execute)
      })
    },
  }
}
