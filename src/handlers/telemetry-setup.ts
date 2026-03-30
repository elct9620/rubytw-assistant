import type { DependencyContainer } from 'tsyringe'
import { TOKENS, type LangfuseConfig } from '../tokens'
import type { RequestContext } from '../context'
import { createTelemetryContext } from '../telemetry/context'
import type { LangfuseTracer } from '../telemetry/tracer'

export function setupTrace(
  child: DependencyContainer,
  options: { name: string; input: Record<string, unknown> },
): LangfuseTracer | undefined {
  const config = child.resolve<LangfuseConfig | null>(TOKENS.LangfuseConfig)
  const { tracer } = createTelemetryContext(config)
  const ctx: RequestContext = {}
  if (tracer) {
    ctx.traceId = tracer.createTrace(options)
  }
  child.register(TOKENS.RequestContext, { useValue: ctx })
  return tracer
}
