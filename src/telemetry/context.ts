import type { LangfuseConfig } from '../tokens'
import { LangfuseClient } from './client'
import { LangfuseTracer } from './tracer'
import { LangfuseTelemetryIntegration } from './integration'

export function createTelemetryContext(
  config: LangfuseConfig | null,
  options?: {
    traceId?: string
    agentName?: string
    skipAgentSpan?: boolean
    parentId?: string
  },
): {
  tracer?: LangfuseTracer
  integrations?: LangfuseTelemetryIntegration[]
} {
  if (!config) {
    return {}
  }

  const client = new LangfuseClient({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
  })

  const tracer = new LangfuseTracer({
    client,
    environment: config.environment,
  })

  if (options?.traceId) {
    tracer.setTraceId(options.traceId)
  }

  const integrations = [
    new LangfuseTelemetryIntegration({
      tracer,
      agentName: options?.agentName,
      skipAgentSpan: options?.skipAgentSpan,
      parentId: options?.parentId,
    }),
  ]

  return { tracer, integrations }
}
