import { AsyncLocalStorage } from 'node:async_hooks'
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

/** The Agents dashboard recognizes an agent only when its spans carry all three. */
interface AgentIdentity {
  'gen_ai.agent.name': string
  'gen_ai.agent.id': string
  'gen_ai.conversation.id': string
}

const conversation = new AsyncLocalStorage<string>()
const agentIdentity = new AsyncLocalStorage<AgentIdentity>()

/** Groups every agent run inside `run` into one dashboard session. */
export function withConversation<T>(conversationId: string, run: () => T): T {
  return conversation.run(conversationId, run)
}

// Custom spans have no setStatus yet, so a failure is recorded as an exception.
async function recordFailure<T>(span: Span, run: () => PromiseLike<T>) {
  try {
    return await run()
  } catch (error) {
    const { name, message } =
      error instanceof Error ? error : new Error(String(error))
    span.setAttribute('error.type', name)
    span.recordException({ name, message })
    throw error
  }
}

/** Runs one agent inside its own span, so its model calls and tool runs nest under it. */
export function invokeAgent<T>(
  agentName: string,
  run: () => PromiseLike<T>,
  tracer: Pick<Tracing, 'enterSpan'> = tracing,
): Promise<T> {
  const identity: AgentIdentity = {
    'gen_ai.agent.name': agentName,
    'gen_ai.agent.id': `${agentName}-production`,
    'gen_ai.conversation.id': conversation.getStore() ?? crypto.randomUUID(),
  }
  return tracer.enterSpan(spanName('invoke_agent', agentName), (span) => {
    span.setAttributes({ 'gen_ai.operation.name': 'invoke_agent', ...identity })
    return agentIdentity.run(identity, () => recordFailure(span, run))
  })
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
          ...agentIdentity.getStore(),
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
